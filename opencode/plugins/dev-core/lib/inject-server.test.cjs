'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { injectSocketPath, startInjectServer } = require('./inject-server.cjs');

function ask(socketPath, request) {
  return new Promise((resolve, reject) => {
    const connection = net.connect(socketPath, () => {
      connection.write(`${JSON.stringify(request)}\n`);
    });
    let buffer = '';
    connection.on('data', (data) => {
      buffer += data;
      if (!buffer.includes('\n')) return;
      connection.end();
      resolve(JSON.parse(buffer.trim()));
    });
    connection.on('error', reject);
  });
}

function createRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-inject-'));
  fs.mkdirSync(path.join(root, '.opencode', 'repo-docs'), { recursive: true });
  return root;
}

test('socket is environment-gated and returns ranked hits', async () => {
  const context = { root: createRoot(), maxFileSizeBytes: 1e6 };
  delete process.env.REPO_DOCS_INJECT;
  assert.strictEqual(await startInjectServer(context), null);

  process.env.REPO_DOCS_INJECT = '1';
  const rank = async () => [{
    path: 'docs/auth.md',
    heading: 'Auth',
    content: 'token refresh '.repeat(30),
    startLine: 1,
    score: 0.9,
  }];
  const server = await startInjectServer(context, { rank, ready: () => true });
  const result = await ask(injectSocketPath(context.root), { query: 'auth' });
  assert.strictEqual(result.injected, true);
  assert.strictEqual(result.hits[0].path, 'docs/auth.md');
  assert.ok(result.hits[0].snippet.length <= 180);

  await new Promise((resolve) => server.close(resolve));
  delete process.env.REPO_DOCS_INJECT;
});

test('reindex requests reuse the running server', async () => {
  const context = { root: createRoot(), maxFileSizeBytes: 1e6 };
  process.env.REPO_DOCS_INJECT = '1';
  let builds = 0;
  const build = async () => { builds += 1; };
  const server = await startInjectServer(context, {
    rank: async () => [],
    build,
    ready: () => true,
  });

  const result = await ask(injectSocketPath(context.root), { op: 'reindex' });
  assert.strictEqual(result.reindexed, true);
  assert.strictEqual(builds, 1);

  await new Promise((resolve) => server.close(resolve));
  delete process.env.REPO_DOCS_INJECT;
});

test('invalidate-deps requests clear the cached dependency graph', async () => {
  const context = {
    root: createRoot(),
    maxFileSizeBytes: 1e6,
    dependencyIndex: { stale: true },
    dependencyIndexPromise: Promise.resolve(),
  };
  process.env.REPO_DOCS_INJECT = '1';
  const server = await startInjectServer(context, {
    rank: async () => [],
    ready: () => true,
  });

  const result = await ask(injectSocketPath(context.root), { op: 'invalidate-deps' });
  assert.strictEqual(result.invalidated, true);
  assert.strictEqual(context.dependencyIndex, null);
  assert.strictEqual(context.dependencyIndexPromise, null);

  await new Promise((resolve) => server.close(resolve));
  delete process.env.REPO_DOCS_INJECT;
});

test('reuses an active socket instead of replacing it', async () => {
  const context = { root: createRoot(), maxFileSizeBytes: 1e6 };
  process.env.REPO_DOCS_INJECT = '1';
  const first = await startInjectServer(context, { rank: async () => [], ready: () => true });
  const second = await startInjectServer(context, { rank: async () => [], ready: () => true });

  assert.strictEqual(second, null);
  assert.strictEqual(fs.existsSync(injectSocketPath(context.root)), true);

  await new Promise((resolve) => first.close(resolve));
  delete process.env.REPO_DOCS_INJECT;
});
