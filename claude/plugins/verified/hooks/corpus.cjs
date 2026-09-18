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

const EMPTY = () => ({
  paths: new Set(), commands: [], searches: [], urls: new Set(),
  libLookup: false, stamps: {}, seq: 0, lastWrite: 0,
});

const snapshot = (ev) => ({
  paths: new Set(ev.paths), commands: [...ev.commands], searches: [...ev.searches],
  urls: new Set(ev.urls), libLookup: ev.libLookup, stamps: {}, seq: ev.seq, lastWrite: ev.lastWrite,
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

/** Every turn in one transcript, each with the manifest as it stood and the one after. */
function worldsFor(file) {
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { return []; }
  const ev = EMPTY();
  const turns = [];
  let answer = '';
  let started = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    const blocks = Array.isArray(r.message && r.message.content) ? r.message.content : [];
    const isUserTurn = r.type === 'user' && !blocks.some((b) => b && b.type === 'tool_result');

    if (isUserTurn) {
      if (started && answer) turns.push({ answer, ev: snapshot(ev) });
      answer = '';
      started = true;
      continue;
    }
    if (!started) continue;

    const errored = new Set();
    for (const b of blocks) if (b && b.type === 'tool_result' && b.is_error) errored.add(b.tool_use_id);
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === 'text' && b.text.trim()) answer = b.text;
      if (b.type === 'tool_use') fold(ev, String(b.name || ''), b.input || {}, !errored.has(b.id));
    }
  }
  if (started && answer) turns.push({ answer, ev: snapshot(ev) });

  // The manifest at end of session is what "did the evidence ever show up" is
  // asked against. Zero re-execution: it is the same record, read once more.
  const final = snapshot(ev);
  return turns.map((t) => ({ ...t, final }));
}

function build(limit) {
  const out = [];
  for (const f of transcripts(limit)) out.push(...worldsFor(f));
  return out;
}

module.exports = { build, worldsFor, transcripts, EMPTY };
