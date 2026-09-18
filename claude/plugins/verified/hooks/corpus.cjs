#!/usr/bin/env node
'use strict';
// Builds replay worlds out of transcripts that already exist.
//
// Dream-RSI's insight (§2, p.3) is that you do not have to collect a simulator:
// "completed discovery histories already provide such a simulator", because every
// outcome is recorded and evaluating an alternative means reading past records.
// That applies here exactly. The ledger the gate writes needs months to hold
// enough turns to score a config change; this machine already has hundreds of
// finished sessions, and each one is a completed discovery tree.
//
// One world = one turn: the answer, the evidence manifest as it stood, and the
// label below.
//
// The label, and why it needs no human. A flag says "this claim was asserted
// before it was checked". The transcript says whether that was true: if the
// session goes on to produce exactly that evidence *later* — reads the path,
// runs the test, fetches the host — then at the moment of the claim it had not
// been checked, and the flag was right. A flag whose evidence never appears
// anywhere in the rest of the session is unconfirmed: it may be a real miss the
// user let slide, or noise. Scoring counts the first as a catch and charges the
// second as cost, which is the same shape as eq. 1's quality-minus-cost.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ledger = require('./ledger.cjs');

const EMPTY = () => ({
  paths: new Set(), commands: [], searches: [], urls: new Set(),
  libLookup: false, stamps: {}, seq: 0, lastWrite: 0, testOut: 0, cwd: '',
});

const snapshot = (ev) => ({
  paths: new Set(ev.paths), commands: [...ev.commands], searches: [...ev.searches],
  urls: new Set(ev.urls), libLookup: ev.libLookup, stamps: {}, seq: ev.seq,
  lastWrite: ev.lastWrite, testOut: ev.testOut, cwd: ev.cwd,
});

function transcripts(limit) {
  const base = path.join(os.homedir(), '.claude', 'projects');
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'subagents') walk(p); }
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(base);
  return out
    .map((f) => { try { return { f, m: fs.statSync(f).mtimeMs }; } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => b.m - a.m)
    .slice(0, limit)
    .map((x) => x.f);
}

// Fold one tool call into a manifest. Mirrors verify-stop's collect closely
// enough to score with; it reads the same fields off the same blocks.
function fold(ev, name, inp, ok) {
  ev.seq += 1;
  if (/^(Edit|Write|NotebookEdit)$/.test(name)) ev.lastWrite = ev.seq;
  const add = (p) => { if (typeof p === 'string' && p) ev.paths.add(p.replace(/^\.\//, '')); };
  add(inp.file_path); add(inp.notebook_path);
  if (typeof inp.path === 'string') add(inp.path);
  if (/Grep|Glob|codegraph/i.test(name)) ev.searches.push({ pattern: String(inp.pattern || inp.query || ''), ok, seq: ev.seq });
  if (/find_libs|read_doc|find_docs/.test(name) || name.startsWith('mcp__')) ev.libLookup = true;
  if (name === 'Bash' && typeof inp.command === 'string') {
    const cmd = inp.command;
    ev.commands.push({ cmd: cmd.slice(0, 300), ok, seq: ev.seq });
    if (/\b(?:rg|grep|ag|ack|find|codegraph)\b/.test(cmd)) ev.searches.push({ pattern: cmd, ok, seq: ev.seq });
    if (/\b(?:opensrc|npm\s+(?:ls|list|view|info)|pip\s+show|cargo\s+tree)\b/.test(cmd)) ev.libLookup = true;
    if (/(^|[\s;&|])(sed\s+-i|tee|cp|mv)\b|>>?\s*[^\s&|>]+\.[A-Za-z0-9]{1,6}(\s|$)/.test(cmd)) ev.lastWrite = ev.seq;
    for (const t of cmd.split(/[\s'"|;&()<>]+/)) if (t.includes('/') || /\.[A-Za-z]\w{0,9}$/.test(t)) add(t);
  }
  if (/WebFetch|WebSearch/i.test(name)) {
    try { ev.urls.add(new URL(inp.url).host); } catch { /* ignore */ }
    if (/WebSearch/i.test(name)) ev.urls.add('*');
  }
}

/** Every turn in one transcript, each with the manifest as it stood and the one after.
 *
 * `maxBytes` truncates the read at the byte length the lock recorded. A pinned
 * world has to stay the same world: transcripts of live sessions keep growing,
 * and a world that gains turns between two replays is not a fixed history. */
function worldsFor(file, maxBytes) {
  let lines;
  try {
    if (maxBytes === undefined || !Number.isFinite(maxBytes)) {
      lines = fs.readFileSync(file, 'utf8').split('\n');
    } else {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.allocUnsafe(maxBytes);
      const n = fs.readSync(fd, buf, 0, maxBytes, 0);
      fs.closeSync(fd);
      // A truncation mid-line leaves an unparseable tail; the JSON.parse below
      // already skips it, so no separate trim is needed.
      lines = buf.subarray(0, n).toString('utf8').split('\n');
    }
  } catch { return []; }
  const ev = EMPTY();
  const turns = [];
  let answer = '';
  let started = false;
  // Which turn of this session a world is, so a label can ask whether the
  // evidence showed up before the claim or after it.
  let idx = -1;
  let ageDays = 999;
  try { ageDays = (Date.now() - fs.statSync(file).mtimeMs) / 86400000; } catch { /* unreadable */ }

  for (const line of lines) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (typeof r.cwd === 'string' && r.cwd) ev.cwd = r.cwd;
    const blocks = Array.isArray(r.message && r.message.content) ? r.message.content : [];
    const isUserTurn = r.type === 'user' && !blocks.some((b) => b && b.type === 'tool_result');

    if (isUserTurn) {
      const said = typeof r.message.content === 'string'
        ? r.message.content
        : blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ');
      if (started && answer) turns.push({ answer, ev: snapshot(ev), nextUser: said, idx, cwd: ev.cwd, ageDays, file, bytes: maxBytes });
      answer = '';
      started = true;
      idx += 1;
      continue;
    }
    if (!started) continue;

    const errored = new Set();
    for (const b of blocks) if (b && b.type === 'tool_result' && b.is_error) errored.add(b.tool_use_id);
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === 'text' && b.text.trim()) answer = b.text;
      if (b.type === 'tool_use') fold(ev, String(b.name || ''), b.input || {}, !errored.has(b.id));
      if (b.type === 'tool_result' && !b.is_error && typeof b.content === 'string'
        && /\b(?:\d+ (?:tests? )?(?:passed|passing)|all tests passed|Tests:\s+\d+ passed|0 failures?|Test Suites:.*passed|build (?:succeeded|complete))/i.test(b.content)) ev.testOut = ev.seq;
    }
  }
  if (started && answer) turns.push({ answer, ev: snapshot(ev), nextUser: '', idx, cwd: ev.cwd, ageDays, file, bytes: maxBytes });

  // The manifest at end of session is what "did the evidence ever show up" is
  // asked against. Zero re-execution: it is the same record, read once more.
  const final = snapshot(ev);
  return turns.map((t) => ({ ...t, final }));
}

// ---- the pinned history ----------------------------------------------------
// Dream-RSI's guarantee is stated over a *fixed* history H_t (p.6): the selected
// policy is no worse than the current one "in average replay score on the fixed
// history". Taking the N most recent transcripts every run does not give a fixed
// history, it gives a new one each session, and the argmax moved with it —
// measured on this machine, the sweep winner was absenceAfterWrite=true at 93
// worlds, absence=false at 569, and path=false at 1553 and 3257. A config that
// wins on one draw can lose on the next, which is exactly what the guarantee is
// supposed to rule out.
//
// So the world set lives in a lockfile and grows only when asked, mirroring
// H_t = H_{t-1} u {T_t}. Entries are never rewritten or dropped.
const lockPath = () => path.join(ledger.dir(), 'worlds.lock.json');

function readLock() {
  try {
    const l = JSON.parse(fs.readFileSync(lockPath(), 'utf8'));
    return Array.isArray(l.worlds) && l.worlds.length ? l : null;
  } catch { return null; }
}

/** Add every transcript not already pinned, at its current byte length. */
function pin(limit) {
  const lock = readLock() || { created: new Date().toISOString(), worlds: [] };
  const have = new Set(lock.worlds.map((w) => w.file));
  let added = 0;
  for (const f of transcripts(limit)) {
    if (have.has(f)) continue;
    let bytes;
    try { bytes = fs.statSync(f).size; } catch { continue; }
    lock.worlds.push({ file: f, bytes });
    added += 1;
  }
  lock.updated = new Date().toISOString();
  fs.mkdirSync(path.dirname(lockPath()), { recursive: true });
  const tmp = lockPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lock, null, 2));
  fs.renameSync(tmp, lockPath());
  return { added, total: lock.worlds.length };
}

/** The pinned worlds when a lock exists, otherwise the N most recent. */
function build(limit) {
  const lock = readLock();
  const src = lock
    ? lock.worlds
    : transcripts(limit).map((f) => ({ file: f, bytes: Infinity }));
  const out = [];
  for (const w of src) out.push(...worldsFor(w.file, w.bytes));
  return out;
}

/**
 * First turn index at which each wanted literal shows up in this session's tool
 * OUTPUT. The manifest records what tools were asked for; this is what they
 * printed, which is where the proof that a flag was wrong actually lives.
 */
function outputIndex(file, maxBytes, wanted) {
  const found = new Map();
  if (!wanted.size) return found;
  let text;
  try {
    const fd = fs.openSync(file, 'r');
    const cap = Number.isFinite(maxBytes) ? maxBytes : fs.statSync(file).size;
    const buf = Buffer.allocUnsafe(cap);
    const n = fs.readSync(fd, buf, 0, cap, 0);
    fs.closeSync(fd);
    text = buf.subarray(0, n).toString('utf8');
  } catch { return found; }

  let idx = -1;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    const blocks = Array.isArray(r.message && r.message.content) ? r.message.content : [];
    if (r.type === 'user' && !blocks.some((b) => b && b.type === 'tool_result')) { idx += 1; continue; }
    for (const b of blocks) {
      if (!b || b.type !== 'tool_result') continue;
      const c = b.content;
      const out = typeof c === 'string' ? c : JSON.stringify(c);
      if (!out) continue;
      for (const w of wanted) if (!found.has(w) && out.includes(w)) found.set(w, idx);
    }
  }
  return found;
}

module.exports = { build, worldsFor, transcripts, EMPTY, pin, readLock, lockPath, outputIndex };
