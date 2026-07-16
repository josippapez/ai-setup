#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { queryInject, formatBlock } = require('./lib/inject-client.cjs');

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

function lastUserText(transcriptPath) {
  let text = '';
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      const msg = row.message || row;
      if (msg && (msg.role === 'user' || row.type === 'user')) {
        const c = msg.content;
        text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p && p.text) || '').join(' ') : text;
      }
    }
  } catch {}
  return text.trim();
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
  const query = lastUserText(event?.transcript_path);
  if (query.replace(/[^a-zA-Z]/g, '').length < 8) process.exit(0);

  const res = await queryInject(root, {
    query,
    limit: num(process.env.REPO_DOCS_INJECT_LIMIT, 3),
    threshold: num(process.env.REPO_DOCS_INJECT_THRESHOLD_PROGRESS, num(process.env.REPO_DOCS_INJECT_THRESHOLD, 0)),
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
