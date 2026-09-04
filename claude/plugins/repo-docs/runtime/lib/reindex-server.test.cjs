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
