'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { startReindexServer, reindexSocketPath } = require('./reindex-server.cjs');

function ask(sockPath, req) {
  return new Promise((resolve, reject) => {
    const c = net.connect(sockPath, () => c.write(JSON.stringify(req) + '\n'));
    let buf = '';
    c.on('data', d => { buf += d; if (buf.includes('\n')) { c.end(); resolve(JSON.parse(buf.trim())); } });
    c.on('error', reject);
  });
}

test('reindex server handles a reindex op by invoking the incremental build', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-'));
  const context = { root, maxFileSizeBytes: 1e6 };
  let builds = 0;
  const build = async () => { builds += 1; return { updated: 1, unchanged: 0, skipped: 0 }; };
  const server = await startReindexServer(context, { build });
  assert.ok(server, 'server should start');

  const res = await ask(reindexSocketPath(root), { op: 'reindex' });
  assert.strictEqual(res.reindexed, true);
  assert.strictEqual(builds, 1, 'reindex op must invoke the build once');

  const unknown = await ask(reindexSocketPath(root), { op: 'query', query: 'x' });
  assert.strictEqual(unknown.error, 'unknown op');
  assert.strictEqual(builds, 1, 'unknown ops never build');

  await new Promise(r => server.close(r));
});

test('a second server resolves null while the first is alive, which stays reachable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-'));
  const context = { root, maxFileSizeBytes: 1e6 };
  const build = async () => ({ updated: 0, unchanged: 0, skipped: 0 });
  const first = await startReindexServer(context, { build });
  assert.ok(first, 'first server should bind');

  const second = await startReindexServer(context, { build });
  assert.strictEqual(second, null, 'a second server on the same socket must resolve null, not steal it');

  const res = await ask(reindexSocketPath(root), { op: 'reindex' });
  assert.strictEqual(res.reindexed, true, 'the first server must still be reachable');

  await new Promise(r => first.close(r));
});

test('a stale socket file with no listener is replaced', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-'));
  const context = { root, maxFileSizeBytes: 1e6 };
  const sockPath = reindexSocketPath(root);
  fs.mkdirSync(path.dirname(sockPath), { recursive: true });
  fs.writeFileSync(sockPath, ''); // orphaned: a file at the path, nobody listening

  const server = await startReindexServer(context, { build: async () => ({}) });
  assert.ok(server, 'a stale socket file must be taken over, not mistaken for a live server');

  const res = await ask(sockPath, { op: 'reindex' });
  assert.strictEqual(res.reindexed, true);

  await new Promise(r => server.close(r));
});

test('a later server can bind after the first one closes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-'));
  const context = { root, maxFileSizeBytes: 1e6 };
  const build = async () => ({});
  const first = await startReindexServer(context, { build });
  assert.ok(first);
  await new Promise(r => first.close(r));

  const second = await startReindexServer(context, { build });
  assert.ok(second, 'a later server must be able to bind once the first is gone');
  await new Promise(r => second.close(r));
});
