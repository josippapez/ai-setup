#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { queryInject, formatBlock, isConversationalFiller } = require('./lib/inject-client.cjs');

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Build the mid-turn query from the transcript. Primary signal: the agent's
// latest output text (what it just said it will do). Thin-fallback: the last
// user message when the assistant text is too short (agent made mostly tool
// calls). Plus light tool-target tokens (edited file basenames / command head)
// from the latest assistant message's tool_use blocks. Kept focused on purpose —
// a long concatenation dilutes the embedding and worsens threshold precision.
function rows(transcriptPath) {
  try {
    return fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function roleOf(row) { const m = row.message || row; return (m && m.role) || row.type; }
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((p) => p && p.type === 'text' && p.text).map((p) => p.text).join(' ');
  return '';
}
function base(p) { return String(p || '').split(/[\\/]/).pop(); }
function toolTargets(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const b of content) {
    if (!b || b.type !== 'tool_use' || !b.input) continue;
    if (b.input.file_path) parts.push(base(b.input.file_path));
    if (b.input.path) parts.push(base(b.input.path));
    if (typeof b.input.command === 'string') parts.push(b.input.command.split(/\s+/).slice(0, 4).join(' '));
  }
  return parts.join(' ');
}
function progressQuery(transcriptPath) {
  const all = rows(transcriptPath);
  let lastAssistant = null, lastUser = '';
  for (const r of all) {
    const role = roleOf(r);
    if (role === 'assistant') lastAssistant = (r.message || r).content;
    else if (role === 'user') lastUser = textOf((r.message || r).content) || lastUser;
  }
  let q = textOf(lastAssistant).trim();
  if (q.replace(/[^a-zA-Z]/g, '').length < 12) q = `${q} ${lastUser}`.trim(); // thin-fallback
  const combined = `${q} ${toolTargets(lastAssistant)}`.trim().replace(/\s+/g, ' ');
  return combined.slice(0, 400); // keep focused
}
function statePath(root, session) {
  return path.join(root, '.claude', 'repo-docs', 'inject-state', `${session || 'default'}.json`);
}
function loadSeen(p) { try { return new Set(JSON.parse(fs.readFileSync(p, 'utf8'))); } catch { return new Set(); } }
function saveSeen(p, set) { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify([...set])); } catch {} }

const main = async () => {
  const events = (process.env.REPO_DOCS_INJECT_EVENTS || 'prompt,batch').split(',').map((s) => s.trim());
  if (!events.includes('batch')) process.exit(0);
  let event;
  try { event = JSON.parse(await readStdin()); } catch { process.exit(0); }
  const root = event?.cwd || process.cwd();
  const query = progressQuery(event?.transcript_path);
  if (query.replace(/[^a-zA-Z]/g, '').length < 8) process.exit(0);
  if (isConversationalFiller(query)) process.exit(0);

  const res = await queryInject(root, {
    query,
    limit: num(process.env.REPO_DOCS_INJECT_LIMIT, 3),
    threshold: num(process.env.REPO_DOCS_INJECT_THRESHOLD_PROGRESS, num(process.env.REPO_DOCS_INJECT_THRESHOLD, 0.86)),
  }, num(process.env.REPO_DOCS_INJECT_TIMEOUT_MS, 300));
  if (!res || !res.injected || !res.hits || !res.hits.length) process.exit(0);

  const sp = statePath(root, event?.session_id);
  const seen = loadSeen(sp);
  const fresh = res.hits.filter((h) => !seen.has(h.path));
  if (fresh.length === 0) process.exit(0);
  fresh.forEach((h) => seen.add(h.path));
  saveSeen(sp, seen);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event?.hook_event_name || 'PostToolBatch', additionalContext: formatBlock(fresh) },
  }));
};
main().catch(() => process.exit(0));
