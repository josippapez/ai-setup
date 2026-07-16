'use strict';

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { rankDocs } = require('./doc-search.cjs');

const MAX_SNIPPET_CHARS = 180;

function injectSocketPath(root) {
  return path.join(root, '.claude', 'repo-docs', 'inject.sock');
}

function snippet(content) {
  return String(content || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[!`*_>#~|[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SNIPPET_CHARS);
}

// Host the injection query socket. No-op unless REPO_DOCS_INJECT=1. First server
// to bind wins; a second (the other byte-identical plugin runtime) sees EADDRINUSE
// and resolves null. Reuses the caller's warm embedder via rankDocs.
async function startInjectServer(context, { rank = rankDocs } = {}) {
  if (process.env.REPO_DOCS_INJECT !== '1') return null;
  const sockPath = injectSocketPath(context.root);
  fs.mkdirSync(path.dirname(sockPath), { recursive: true });

  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', async (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      let req;
      try { req = JSON.parse(buf.slice(0, nl)); } catch { conn.end(); return; }
      try {
        const hits = await rank(context, {
          query: String(req.query || ''),
          limit: Number(req.limit) || 3,
          threshold: Number(req.threshold) || 0,
        });
        const out = hits.map(h => ({
          path: h.path, startLine: h.startLine, heading: h.heading, snippet: snippet(h.content), score: h.score,
        }));
        conn.end(JSON.stringify({ hits: out, injected: out.length > 0 }) + '\n');
      } catch {
        conn.end(JSON.stringify({ hits: [], injected: false }) + '\n');
      }
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

module.exports = { startInjectServer, injectSocketPath };
