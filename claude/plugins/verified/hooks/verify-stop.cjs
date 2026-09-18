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

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const MAX_REPEAT_BLOCKS = 3; // then downgrade to a visible flag rather than burn the turn

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};

// ---- stage 1: evidence manifest -------------------------------------------
// One entry per tool call made since the last Stop. Nothing else is retained:
// the manifest is what the claim checks run against, not a copy of the session.
function buildEvidence(transcriptPath, session) {
  const ev = { paths: new Set(), commands: [], searches: [], urls: new Set(), libLookup: false };
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
    for (const rec of records) collect(rec, ev, errored);
  } catch {
    return ev;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
  return ev;
}

function blocksOf(rec) {
  const content = rec && rec.message && rec.message.content;
  return Array.isArray(content) ? content.filter(Boolean) : [];
}

function collect(rec, ev, errored) {
  for (const b of blocksOf(rec)) {
    if (b.type !== 'tool_use') continue;
    const name = String(b.name || '');
    const inp = b.input || {};
    const ok = !errored.has(b.id);

    if (inp.file_path) ev.paths.add(norm(inp.file_path));
    if (inp.notebook_path) ev.paths.add(norm(inp.notebook_path));
    if (inp.path && typeof inp.path === 'string') ev.paths.add(norm(inp.path));

    if (/Grep|Glob/.test(name)) ev.searches.push({ pattern: String(inp.pattern || inp.glob || ''), ok });
    if (/codegraph/i.test(name)) {
      ev.searches.push({ pattern: String(inp.query || ''), ok });
      for (const w of String(inp.query || '').split(/\s+/)) if (/[/.]/.test(w)) ev.paths.add(norm(w));
    }
    if (/find_libs|read_doc|find_docs/.test(name)) ev.libLookup = true;

    if (name === 'Bash' && typeof inp.command === 'string') {
      const cmd = inp.command;
      ev.commands.push({ cmd, ok });
      if (SEARCH_CMD_RE.test(cmd)) ev.searches.push({ pattern: cmd, ok });
      if (LIB_CMD_RE.test(cmd)) ev.libLookup = true;
      // Any path-looking token the command touched counts as read.
      for (const t of cmd.split(/[\s'"|;&()<>]+/)) {
        if (/[\w.-]+\.[A-Za-z]\w{0,9}$/.test(t) || t.includes('/')) {
          ev.paths.add(norm(t));
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
    if (MANIFEST_RE.test(String(inp.file_path || ''))) ev.libLookup = true;
  }
}

// ---- stage 3: residual judge ----------------------------------------------
// Only classification: does this sentence assert something checkable? Never
// whether it is true — that is stage 2's job against the manifest. Keeping the
// model on the narrow question is what makes a small one adequate.

function judge(residual, ev) {
  const trimmed = residual.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 80) return [];
  let promptTemplate;
  try {
    promptTemplate = fs.readFileSync(path.join(PLUGIN_ROOT, 'judge', 'judge-prompt.md'), 'utf8');
  } catch {
    return [];
  }
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter((s) => s.length > 25).slice(0, 40);
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
      `Do not restate the claim unchanged.`,
  }));
};

main().catch(() => process.exit(0));
