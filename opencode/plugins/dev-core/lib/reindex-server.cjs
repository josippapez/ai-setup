'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { buildDocIndex } = require('../tools/build-semantic-index.cjs');

function reindexSocketPath(root) {
  return path.join(root, '.opencode', 'repo-docs', 'inject.sock');
}

function socketIsActive(socketPath, timeoutMs = 200) {
  return new Promise((resolve) => {
    const connection = net.connect(socketPath);
    const timer = setTimeout(() => {
      connection.destroy();
      resolve(false);
    }, timeoutMs);
    connection.once('connect', () => {
      clearTimeout(timer);
      connection.end();
      resolve(true);
    });
    connection.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// Host the mid-session reindex socket: the OpenCode plugin asks this server
// (which holds the warm embedder) to re-embed changed docs after a Markdown
// edit. A live sibling already owning the socket wins; we resolve null.
async function startReindexServer(context, { build = buildDocIndex } = {}) {
  const socketPath = reindexSocketPath(context.root);
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  if (fs.existsSync(socketPath) && await socketIsActive(socketPath)) return null;

  const server = net.createServer((connection) => {
    let buffer = '';
    connection.on('data', async (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      let request;
      try { request = JSON.parse(buffer.slice(0, newline)); } catch { connection.end(); return; }
      if (request.op !== 'reindex') { connection.end(`${JSON.stringify({ error: 'unknown op' })}\n`); return; }
      // Incremental via mtime cache, so typically just the one edited file.
      try { await build(context); connection.end(`${JSON.stringify({ reindexed: true })}\n`); }
      catch { connection.end(`${JSON.stringify({ reindexed: false })}\n`); }
    });
    connection.on('error', () => {});
  });

  return await new Promise((resolve) => {
    server.once('error', () => resolve(null));
    try { fs.rmSync(socketPath, { force: true }); } catch {}
    server.listen(socketPath, () => resolve(server));
  });
}

module.exports = { startReindexServer, reindexSocketPath };
