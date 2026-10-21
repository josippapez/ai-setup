'use strict';

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { buildDocIndex } = require('../tools/build-semantic-index.cjs');
const { CONFIG_DIR } = require('./platform.cjs');

function reindexSocketPath(root) {
  return path.join(root, CONFIG_DIR, 'repo-docs', 'inject.sock');
}

// Probe whether a socket path is a live listener (vs. a file orphaned by a
// crashed server): a successful connect means someone is on the other end.
function socketIsActive(sockPath, timeoutMs = 200) {
  return new Promise((resolve) => {
    const conn = net.connect(sockPath);
    const timer = setTimeout(() => { conn.destroy(); resolve(false); }, timeoutMs);
    conn.once('connect', () => { clearTimeout(timer); conn.end(); resolve(true); });
    conn.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

function attemptListen(server, sockPath) {
  return new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(sockPath, () => resolve(true));
  });
}

// Host the mid-session reindex socket: the PostToolUse hook asks the running
// server (which holds the warm embedder) to re-embed changed docs after a
// Markdown edit. First server to bind wins; a second (another runtime on the
// same repo) sees EADDRINUSE and resolves null.
async function startReindexServer(context, { build = buildDocIndex } = {}) {
  const sockPath = reindexSocketPath(context.root);
  fs.mkdirSync(path.dirname(sockPath), { recursive: true });

  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', async (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      let req;
      try { req = JSON.parse(buf.slice(0, nl)); } catch { conn.end(); return; }
      if (req.op !== 'reindex') { conn.end(JSON.stringify({ error: 'unknown op' }) + '\n'); return; }
      // Incremental via mtime cache, so typically just the one edited file.
      try { await build(context); conn.end(JSON.stringify({ reindexed: true }) + '\n'); }
      catch { conn.end(JSON.stringify({ reindexed: false }) + '\n'); }
    });
    conn.on('error', () => {});
  });

  if (await attemptListen(server, sockPath)) return server;
  // listen() fails whenever the path already exists, live or not — probe before
  // taking it over so a live sibling's socket is never unlinked out from under it.
  if (await socketIsActive(sockPath)) return null;
  try { fs.rmSync(sockPath, { force: true }); } catch {}
  return (await attemptListen(server, sockPath)) ? server : null;
}

// startReindexServer once, and if another session holds the socket, keep trying while this
// process runs: that session's exit removes the socket, and without a retry no session
// would reindex edits again. Stops trying once it hosts. unref: never keeps the process alive.
async function keepReindexServer(context, { build, intervalMs = Number(process.env.REPO_DOCS_REINDEX_RETRY_MS) || 30000, onServer = () => {} } = {}) {
  const opts = build ? { build } : undefined;
  let timer = null;
  let stopped = false;
  const stop = () => { stopped = true; if (timer) clearInterval(timer); timer = null; };
  const attempt = async () => {
    const server = await startReindexServer(context, opts);
    if (!server) return null;
    if (stopped) { server.close(); return null; }
    stop();
    onServer(server);
    return server;
  };
  const first = await attempt();
  if (!first && !stopped) {
    let busy = false;
    timer = setInterval(() => {
      if (busy) return;
      busy = true;
      attempt().catch(() => {}).finally(() => { busy = false; });
    }, intervalMs);
    timer.unref();
  }
  return { server: first, stop };
}

module.exports = { startReindexServer, keepReindexServer, reindexSocketPath };
