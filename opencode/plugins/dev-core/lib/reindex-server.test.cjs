'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { reindexSocketPath, startReindexServer } = require('./reindex-server.cjs');

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-reindex-'));
  fs.mkdirSync(path.join(root, '.opencode', 'repo-docs'), { recursive: true });
  return root;
}

test('reindex requests reuse the running server; other ops are rejected', async () => {
  const context = { root: createRoot(), maxFileSizeBytes: 1e6 };
  let builds = 0;
  const build = async () => { builds += 1; };
  const server = await startReindexServer(context, { build });

  const result = await ask(reindexSocketPath(context.root), { op: 'reindex' });
  assert.strictEqual(result.reindexed, true);
  assert.strictEqual(builds, 1);

  const unknown = await ask(reindexSocketPath(context.root), { op: 'query', query: 'x' });
  assert.strictEqual(unknown.error, 'unknown op');
  assert.strictEqual(builds, 1);

  await new Promise((resolve) => server.close(resolve));
});

test('reuses an active socket instead of replacing it', async () => {
  const context = { root: createRoot(), maxFileSizeBytes: 1e6 };
  const first = await startReindexServer(context, { build: async () => {} });
  const second = await startReindexServer(context, { build: async () => {} });

  assert.strictEqual(second, null);
  assert.strictEqual(fs.existsSync(reindexSocketPath(context.root)), true);

  await new Promise((resolve) => first.close(resolve));
});
