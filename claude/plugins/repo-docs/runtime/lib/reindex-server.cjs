'use strict';

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { buildDocIndex } = require('../tools/build-semantic-index.cjs');

function reindexSocketPath(root) {
  return path.join(root, '.claude', 'repo-docs', 'inject.sock');
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

  return await new Promise((resolve) => {
    server.once('error', () => { resolve(null); });
    // Proactively clear a stale socket file before binding.
    try { fs.rmSync(sockPath, { force: true }); } catch {}
    server.listen(sockPath, () => resolve(server));
  });
}

module.exports = { startReindexServer, reindexSocketPath };
