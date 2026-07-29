'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { rankDocs } = require('./doc-search.cjs');
const { isReady } = require('./semantic-index.cjs');
const { invalidateDependencyIndex } = require('./dependency-index.cjs');
const { buildDocIndex } = require('../tools/build-semantic-index.cjs');

const MAX_SNIPPET_CHARS = 180;

function injectSocketPath(root) {
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

function snippet(content) {
  return String(content || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[!`*_>#~|[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SNIPPET_CHARS);
}

async function startInjectServer(
  context,
  { rank = rankDocs, build = buildDocIndex, ready = isReady } = {},
) {
  if (process.env.REPO_DOCS_INJECT !== '1') return null;
  const socketPath = injectSocketPath(context.root);
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  if (fs.existsSync(socketPath) && await socketIsActive(socketPath)) return null;

  const server = net.createServer((connection) => {
    let buffer = '';
    connection.on('data', async (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      let request;
      try {
        request = JSON.parse(buffer.slice(0, newline));
      } catch {
        connection.end();
        return;
      }
      if (request.op === 'reindex') {
        try {
          await build(context);
          connection.end(`${JSON.stringify({ reindexed: true })}\n`);
        } catch {
          connection.end(`${JSON.stringify({ reindexed: false })}\n`);
        }
        return;
      }
      // Source-file edit: drop the cached dependency graph so the next
      // dependency-tool call rebuilds it (cheap, no re-embedding involved).
      if (request.op === 'invalidate-deps') {
        invalidateDependencyIndex(context);
        connection.end(`${JSON.stringify({ invalidated: true })}\n`);
        return;
      }
      if (!ready()) {
        connection.end(`${JSON.stringify({ hits: [], injected: false, warming: true })}\n`);
        return;
      }
      try {
        const hits = await rank(context, request);
        const result = hits.map((hit) => ({
          path: hit.path,
          startLine: hit.startLine,
          heading: hit.heading,
          snippet: snippet(hit.content),
          score: hit.score,
        }));
        connection.end(`${JSON.stringify({ hits: result, injected: result.length > 0 })}\n`);
      } catch {
        connection.end(`${JSON.stringify({ hits: [], injected: false })}\n`);
      }
    });
    connection.on('error', () => {});
  });

  return new Promise((resolve) => {
    server.once('error', () => resolve(null));
    try {
      fs.rmSync(socketPath, { force: true });
    } catch {}
    server.once('close', () => {
      try {
        fs.rmSync(socketPath, { force: true });
      } catch {}
    });
    server.listen(socketPath, () => resolve(server));
  });
}

module.exports = { injectSocketPath, startInjectServer };
