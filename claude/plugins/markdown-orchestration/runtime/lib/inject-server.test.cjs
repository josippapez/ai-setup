'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { startInjectServer, injectSocketPath } = require('./inject-server.cjs');

function ask(sockPath, req) {
  return new Promise((resolve, reject) => {
    const c = net.connect(sockPath, () => c.write(JSON.stringify(req) + '\n'));
    let buf = '';
    c.on('data', d => { buf += d; if (buf.includes('\n')) { c.end(); resolve(JSON.parse(buf.trim())); } });
    c.on('error', reject);
  });
}

test('inject server returns ranked hits over the socket, gated by env', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-'));
  fs.mkdirSync(path.join(root, '.claude', 'repo-docs'), { recursive: true });
  const context = { root, maxFileSizeBytes: 1e6 };

  // env off → no server
  delete process.env.REPO_DOCS_INJECT;
  assert.strictEqual(await startInjectServer(context), null);

  // env on → server, with a stub ranker (no model needed)
  process.env.REPO_DOCS_INJECT = '1';
  const stub = async (_ctx, { query }) =>
    query.includes('auth') ? [{ path: 'docs/auth.md', heading: 'Auth', content: 'token refresh '.repeat(30), startLine: 1, score: 0.9 }] : [];
  const server = await startInjectServer(context, { rank: stub });
  assert.ok(server, 'server should start when enabled');

  const hit = await ask(injectSocketPath(root), { query: 'auth login', limit: 3, threshold: 0 });
  assert.strictEqual(hit.injected, true);
  assert.strictEqual(hit.hits[0].path, 'docs/auth.md');
  assert.ok(hit.hits[0].snippet.length <= 180);

  const miss = await ask(injectSocketPath(root), { query: 'unrelated', limit: 3, threshold: 0 });
  assert.strictEqual(miss.injected, false);
  assert.deepStrictEqual(miss.hits, []);

  await new Promise(r => server.close(r));
  delete process.env.REPO_DOCS_INJECT;
});

test('inject server handles a reindex op by invoking the incremental build', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-reindex-'));
  fs.mkdirSync(path.join(root, '.claude', 'repo-docs'), { recursive: true });
  const context = { root, maxFileSizeBytes: 1e6 };

  process.env.REPO_DOCS_INJECT = '1';
  let builds = 0;
  const build = async () => { builds += 1; return { updated: 1, unchanged: 0, skipped: 0 }; };
  const server = await startInjectServer(context, { rank: async () => [], build });
  assert.ok(server, 'server should start when enabled');

  const res = await ask(injectSocketPath(root), { op: 'reindex' });
  assert.strictEqual(res.reindexed, true);
  assert.strictEqual(builds, 1, 'reindex op must invoke the build once');

  await new Promise(r => server.close(r));
  delete process.env.REPO_DOCS_INJECT;
});

test('inject server handles an invalidate-deps op by clearing the cached graph', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-invalidate-'));
  fs.mkdirSync(path.join(root, '.claude', 'repo-docs'), { recursive: true });
  const context = { root, maxFileSizeBytes: 1e6, dependencyIndex: { stale: true }, dependencyIndexPromise: Promise.resolve() };

  process.env.REPO_DOCS_INJECT = '1';
  const server = await startInjectServer(context, { rank: async () => [] });
  const res = await ask(injectSocketPath(root), { op: 'invalidate-deps' });
  assert.strictEqual(res.invalidated, true);
  assert.strictEqual(context.dependencyIndex, null);
  assert.strictEqual(context.dependencyIndexPromise, null);

  await new Promise(r => server.close(r));
  delete process.env.REPO_DOCS_INJECT;
});
