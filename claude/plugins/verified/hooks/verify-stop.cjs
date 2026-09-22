#!/usr/bin/env node
'use strict';
// Stop hook: refuse to end a turn whose answer asserts things that were never checked.
//
// The observed case: this repo's correctness guidance is eight plugins' worth of
// prose injected before the model acts (SessionStart, SubagentStart,
// UserPromptSubmit, PreToolUse) and exactly one hook that enforces anything
// (git-mv-guard). evidence-first Gate 1 already states the rule — "if you cannot
// point to a file:line, a command output, or a URL you fetched this session, it is
// not a finding" — and nothing checks whether it was obeyed. So answers assert
// unchecked things and the user re-verifies by hand.
//
// Structure follows Dream-RSI (dream-rsi.com, §3): the session transcript is a
// recorded discovery history whose outcomes are already stored, so a claim can be
// scored against what actually ran at zero re-execution cost. The evaluator stays
// fixed — it is this file plus judge-prompt.md, not the agent's own judgment —
// because the paper's guarantee only holds when the thing being checked does not
// get to rewrite the checker (p.5).
//
// Five stages, short-circuiting. Stages 1-2 are deterministic and always run.
// Stage 3 spawns a small model only for what the patterns could not settle, which
// on most turns is nothing.
//
// Fails open everywhere. A gate that takes the turn down when it errors is worse
// than no gate.

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { classify, norm, BACKED_BY, MANIFEST_RE, SEARCH_CMD_RE, LIB_CMD_RE } = require('./claim-patterns.cjs');
const ledger = require('./ledger.cjs');
const { TEST_PASS_RE, outputKind, pathsInOutput } = require('./corpus.cjs');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const MAX_REPEAT_BLOCKS = 3; // then downgrade to a visible flag rather than burn the turn

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};

// ---- stage 1: evidence manifest -------------------------------------------
// One entry per tool call the session has made, accumulated across turns. Only
// the bytes appended since the last Stop are parsed; the rest comes from the
// stored manifest. Nothing else is retained: this is what the claim checks run
// against, not a copy of the session.
function buildEvidence(transcriptPath, session) {
  // Start from what this session has already gathered, then add only the bytes
  // appended since the last Stop. The offset keeps the parse cheap; the stored
  // manifest keeps the scope honest.
  const ev = ledger.readManifest(session);
  if (!transcriptPath) return ev;
  let fd;
  try {
    const size = fs.statSync(transcriptPath).size;
    let from = ledger.getOffset(session);
    if (from > size) from = 0; // transcript rotated or truncated
    fd = fs.openSync(transcriptPath, 'r');
    const len = size - from;
    if (len <= 0) return ev;
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, from);
    ledger.setOffset(session, size);

    const records = [];
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { /* partial or malformed line */ }
    }
    // Two passes, because a tool_result lands in the record *after* the tool_use
    // that produced it. Collecting failures per-record found none, so a claim of
    // "tests pass" was backed by a test command that had actually errored.
    const errored = new Set();
    for (const rec of records) {
      for (const b of blocksOf(rec)) {
        if (b.type === 'tool_result' && b.is_error) errored.add(b.tool_use_id);
      }
    }
    const toolOf = new Map();
    for (const rec of records) collect(rec, ev, errored, toolOf);
    ledger.writeManifest(session, ev);
  } catch {
    return ev;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
  return ev;
}

// Evidence expires when the thing it describes changes. Costs one statSync per
// remembered path; the largest real session in this user's history held 1069.
function pruneStale(ev) {
  for (const p of [...ev.paths]) {
    const was = ev.stamps[p];
    if (was === undefined || was === null) continue; // never resolved to a real file
    let now = null;
    try { now = fs.statSync(p).mtimeMs; } catch { /* deleted */ }
    if (now !== was) { ev.paths.delete(p); delete ev.stamps[p]; }
  }
}

function blocksOf(rec) {
  const content = rec && rec.message && rec.message.content;
  return Array.isArray(content) ? content.filter(Boolean) : [];
}

// Stamp a path with the file's mtime at the moment it was read. A later claim
// about that path is only backed if the file still has that mtime: session-scoped
// evidence otherwise lets a read at turn 3 vouch for a claim at turn 90 about a
// file that changed in between.
function see(ev, p) {
  const n = norm(p);
  if (!n) return;
  ev.paths.add(n);
  if (ev.stamps[n] === undefined) {
    try { ev.stamps[n] = fs.statSync(n).mtimeMs; } catch { ev.stamps[n] = null; }
  }
}

function collect(rec, ev, errored, toolOf) {
  for (const b of blocksOf(rec)) {
    if (b.type === 'tool_result' && !b.is_error) {
      const c = b.content;
      const out = typeof c === 'string' ? c : JSON.stringify(c || '');
      if (out && TEST_PASS_RE.test(out)) ev.testOut = ev.seq;
      const src = toolOf.get(b.tool_use_id);
      if (out && src && outputKind(src.tool, src.cmd) === 'content') for (const p of pathsInOutput(out)) see(ev, p);
      continue;
    }
    if (b.type !== 'tool_use') continue;
    const name = String(b.name || '');
    const inp = b.input || {};
    toolOf.set(b.id, { tool: name, cmd: inp.command });
    const ok = !errored.has(b.id);
    ev.seq += 1;
    // A write invalidates any earlier "the tests pass": the thing that passed is
    // no longer the thing on disk.
    if (/^(Edit|Write|NotebookEdit)$/.test(name)) ev.lastWrite = ev.seq;

    if (inp.file_path) see(ev, inp.file_path);
    if (inp.notebook_path) see(ev, inp.notebook_path);
    if (inp.path && typeof inp.path === 'string') see(ev, inp.path);

    if (/Grep|Glob/.test(name)) ev.searches.push({ pattern: String(inp.pattern || inp.glob || ''), ok, seq: ev.seq });
    if (/codegraph/i.test(name)) {
      ev.searches.push({ pattern: String(inp.query || ''), ok, seq: ev.seq });
      for (const w of String(inp.query || '').split(/\s+/)) if (/[/.]/.test(w)) ev.paths.add(norm(w));
    }
    if (/find_libs|read_doc|find_docs/.test(name)) ev.libLookup = true;

    if (name === 'Bash' && typeof inp.command === 'string') {
      const cmd = inp.command;
      ev.commands.push({ cmd, ok, seq: ev.seq });
      if (/(^|[\s;&|])(sed\s+-i|tee|cp|mv|install\.sh)\b|>>?\s*[^\s&|>]+\.[A-Za-z0-9]{1,6}(\s|$)/.test(cmd)) ev.lastWrite = ev.seq;
      if (SEARCH_CMD_RE.test(cmd)) ev.searches.push({ pattern: cmd, ok, seq: ev.seq });
      if (LIB_CMD_RE.test(cmd)) ev.libLookup = true;
      // Any path-looking token the command touched counts as read.
      for (const t of cmd.split(/[\s'"|;&()<>]+/)) {
        if (/[\w.-]+\.[A-Za-z]\w{0,9}$/.test(t) || t.includes('/')) {
          see(ev, t);
          if (MANIFEST_RE.test(t)) ev.libLookup = true;
        }
      }
    }

    if (/WebFetch|WebSearch|web_fetch|web_search/i.test(name)) {
      const u = inp.url || '';
      if (u) { try { ev.urls.add(new URL(u).host); } catch { /* ignore */ } }
      // A search backs any host it could have returned; treat it as a wildcard.
      if (name === 'WebSearch' || /web_search/i.test(name)) ev.urls.add('*');
    }
    // Every MCP tool reaches something outside this repo, so any of them counts
    // as external evidence. Without this a turn that read a design through the
    // Figma MCP looked like it had fetched nothing, and claims about Figma's
    // component model were flagged unbacked in the precision sample.
    if (name.startsWith('mcp__')) ev.libLookup = true;
    if (MANIFEST_RE.test(String(inp.file_path || ''))) ev.libLookup = true;
  }
}

// A sentence about the speaker, the reader, or the conversation is not a claim
// about the world, and nothing in a tool manifest can settle it. Both zero-tool
// turns in the precision sample blocked on exactly this shape ("I did not see
// the conversation behind that line", "You were getting session recaps nobody
// could read"), so these never reach the judge.
const CONVERSATIONAL_RE =
  /^(?:so\s+|and\s+|but\s+|then\s+|also\s+|okay,?\s+|right,?\s+)?(?:i|i'd|i'll|i've|i'm|you|you'd|you'll|you've|you're|we|we'd|we'll|we've|we're|let\s+me|let's|my|your|our)\b/i;

// ---- stage 3: residual judge (off by default) ------------------------------
// Only classification: does this sentence assert something checkable? Never
// whether it is true — that is stage 2's job against the manifest. Keeping the
// model on the narrow question is what makes a small one adequate.
//
// Off unless VERIFIED_JUDGE_ENABLED=1. Replaying the gate over 476 real turns,
// this fired on 92.5% of them, not the handful the design assumed, and a call
// costs 5-56s (median ~38s). That cost is `claude -p` process boot, not model
// work: 5 sentences took 26.1s and 30 took 19.4s, so no payload cap makes it
// cheap. Half a minute on nine turns in ten is not worth what it adds over the
// deterministic pass, which runs in 1.26ms and already blocks 36.8% of turns.
//
// Turn it on for a session where correctness is worth the wall-clock:
//   VERIFIED_JUDGE_ENABLED=1 claude
function judge(residual, ev) {
  if (process.env.VERIFIED_JUDGE_ENABLED !== '1') return [];
  // A turn that gathered nothing is a conversational turn: explaining, recapping,
  // answering from what was already said. There is no manifest to check against,
  // so every sentence would look unbacked. Both such turns in the precision
  // sample blocked, and both were wrong.
  if (ev.commands.length === 0 && ev.paths.size === 0 && ev.searches.length === 0 && ev.urls.size === 0) return [];
  const trimmed = residual.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 80) return [];
  let promptTemplate;
  try {
    promptTemplate = fs.readFileSync(path.join(PLUGIN_ROOT, 'judge', 'judge-prompt.md'), 'utf8');
  } catch {
    return [];
  }
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 25 && !CONVERSATIONAL_RE.test(s.trim()))
    .slice(0, 40);
  if (sentences.length === 0) return [];
  const payload = promptTemplate + '\n\n' + sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');

  let out;
  try {
    out = execFileSync(
      'claude',
      [
        '-p', '--model', 'haiku',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--settings', path.join(PLUGIN_ROOT, 'judge', 'judge-settings.json'),
      ],
      {
        input: payload,
        encoding: 'utf8',
        timeout: 45000,
        // VERIFIED_JUDGE is the reentry guard: the child fires its own Stop, and
        // without this the gate would recurse into itself.
        env: { ...process.env, VERIFIED_JUDGE: '1' },
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
  } catch {
    return []; // judge unavailable: stage 2 already ran, do not block on its absence
  }

  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return [];
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch { return []; }
  const claims = Array.isArray(parsed.claims) ? parsed.claims : [];
  return claims
    .filter((c) => c && c.checkable === true && sentences[c.i - 1])
    // An unrecognised kind is treated as needing evidence of some sort, which is
    // the conservative reading and still consults the manifest.
    .filter((c) => !(BACKED_BY[c.kind] || BACKED_BY.state)(ev))
    .map((c) => ({
      class: `residual:${c.kind || 'unknown'}`,
      span: sentences[c.i - 1].slice(0, 160),
      needs: String(c.needs || 'evidence from this session'),
    }));
}

// ---- main ------------------------------------------------------------------
const main = async () => {
  // Stage 0: reentry guard. The judge child runs `claude`, which fires this hook.
  if (process.env.VERIFIED_JUDGE === '1') return;

  let ev0 = {};
  try { ev0 = JSON.parse(await readStdin()); } catch { return; }

  const answer = ev0.last_assistant_message;
  if (typeof answer !== 'string' || !answer.trim()) return;
  const session = String(ev0.session_id || 'unknown');

  const evidence = buildEvidence(ev0.transcript_path, session);
  evidence.cwd = typeof ev0.cwd === 'string' ? ev0.cwd : process.cwd();
  pruneStale(evidence);
  const { unbacked, residualText } = classify(answer, evidence);

  const all = unbacked.concat(judge(residualText, evidence));
  const spans = new Set(all.map((c) => c.span));
  ledger.resolvePrevious(session, spans);

  // The node carries the answer and the manifest, not just the verdict, because
  // stage 5 has to re-run classification under a different config without
  // re-executing anything. That is the whole point of a replay simulator: the
  // stored record has to be complete enough to score an alternative against.
  const node = {
    ts: new Date().toISOString(),
    session,
    answer,
    evidence: {
      paths: [...evidence.paths],
      commands: evidence.commands,
      searches: evidence.searches,
      urls: [...evidence.urls],
      libLookup: evidence.libLookup,
      // Replay re-classifies under a different config, and the outcome class
      // compares a command's seq against lastWrite. Without these two the node
      // replays as though nothing had ever been written.
      seq: evidence.seq,
      lastWrite: evidence.lastWrite,
      testOut: evidence.testOut,
      cwd: evidence.cwd,
    },
  };

  if (all.length === 0) {
    ledger.append({ ...node, claims: [], action: 'pass' });
    return;
  }

  // A claim the model has failed to fix across repeated blocks is more likely a
  // false positive than a stubborn lie. Flag it and let the turn end rather than
  // spend the harness's 8-continuation cap arguing with a bad pattern.
  const repeats = ledger.read()
    .filter((n) => n.session === session && n.action === 'block')
    .slice(-MAX_REPEAT_BLOCKS);
  const stuck =
    repeats.length >= MAX_REPEAT_BLOCKS &&
    repeats.every((n) => (n.claims || []).some((c) => spans.has(c.span)));

  const list = all.map((c) => `  - [${c.class}] "${c.span}" — needs ${c.needs}`).join('\n');
  // path-missing asks the local disk, so a path the session checked over SSH or
  // on a device reads as fiction. The gate cannot see that machine; the model can.
  const remote = all.some((c) => c.class === 'path-missing')
    ? `A [path-missing] flag only checks this machine. If that path lives on another one ` +
      `(an SSH host, a container, a device), treat the flag as a suggestion: say which machine ` +
      `in one line and finish, without repeating the path. `
    : '';
  ledger.append({
    ...node,
    claims: all.map(({ class: cls, span }) => ({ class: cls, span })),
    decided_by: unbacked.length ? 'stage2' : 'stage3',
    action: stuck ? 'flag' : 'block',
  });

  if (stuck) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: ev0.hook_event_name || 'Stop',
        additionalContext:
          `verified: still unbacked after ${MAX_REPEAT_BLOCKS} attempts, letting the turn end. ` +
          `Tell the user these are unverified:\n${list}`,
      },
    }));
    return;
  }

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason:
      `verified: your answer asserts ${all.length} thing${all.length > 1 ? 's' : ''} nothing in ` +
      `this session backs.\n${list}\n\n` +
      `Go run the check, or reword the claim as the guess it is, then finish the turn. ` +
      `A name used only as an example is not a claim once it is written as e.g. NAME or "NAME". ` +
      remote +
      `Do not restate the claim unchanged.`,
  }));
};

main().catch(() => process.exit(0));
