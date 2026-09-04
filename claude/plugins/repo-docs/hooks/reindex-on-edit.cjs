#!/usr/bin/env node
'use strict';

// PostToolUse hook: after a Markdown file is written/edited, ask the running MCP
// server (which holds the warm embedder) to re-embed changed docs via its
// reindex socket, so mid-session doc edits are searchable without a reconnect.
// Self-contained (node: builtins only), fire-and-forget, fail-safe.
//
// A cross-process debounce lock keeps a burst of edits (or a second runtime on
// the same repo) from triggering duplicate reindexes.

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const DEBOUNCE_MS = 2000;

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};

const normalizeTool = (v) => {
  if (typeof v !== 'string') return '';
  const parts = v.split(/[./:]/).filter(Boolean);
  return (parts.length ? parts[parts.length - 1] : v).trim().toLowerCase();
};

const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit', 'create', 'apply_patch']);

function editedPath(event) {
  const input = event.tool_input || event.toolInput || event.input || {};
  return input.file_path || input.path || '';
}

// Cross-process debounce: whoever claims the lock (exclusive create, or a stale
// lock past the window) does the reindex; concurrent siblings skip.
function claimReindex(lockPath) {
  try {
    const st = fs.statSync(lockPath);
    if (Date.now() - st.mtimeMs < DEBOUNCE_MS) return false; // a reindex just ran
    fs.writeFileSync(lockPath, String(Date.now())); // stale → refresh + claim
    return true;
  } catch {
    try { fs.writeFileSync(lockPath, String(Date.now()), { flag: 'wx' }); return true; }
    catch { return false; } // lost the create race → sibling handles it
  }
}

function sendOp(root, op) {
  return new Promise((resolve) => {
    const sock = path.join(root, '.claude', 'repo-docs', 'inject.sock');
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const c = net.connect(sock);
    const timer = setTimeout(() => { c.destroy(); finish(); }, 1500);
    c.on('connect', () => c.write(JSON.stringify({ op }) + '\n'));
    c.on('data', () => { clearTimeout(timer); c.end(); finish(); });
    c.on('error', () => { clearTimeout(timer); finish(); });
    c.on('close', () => { clearTimeout(timer); finish(); });
  });
}

const main = async () => {
  let event;
  try { event = JSON.parse(await readStdin()); } catch { process.exit(0); }
  const tool = normalizeTool(event.tool_name || event.toolName || event.tool || event.name);
  if (!EDIT_TOOLS.has(tool)) process.exit(0);
  const file = editedPath(event);
  const root = event.cwd || process.cwd();
  if (!/\.mdx?$/i.test(file)) process.exit(0);
  if (!claimReindex(path.join(root, '.claude', 'repo-docs', 'reindex.lock'))) process.exit(0);
  await sendOp(root, 'reindex');
  process.exit(0);
};

main().catch(() => process.exit(0));
