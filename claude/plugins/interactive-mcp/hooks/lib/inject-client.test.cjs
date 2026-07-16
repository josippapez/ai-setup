'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { injectSocketPath, queryInject, formatBlock } = require('./inject-client.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inject-client-'));
}

// Bind a stub server at injectSocketPath(root) that replies with the given object.
function startStub(root, reply) {
  const sock = injectSocketPath(root);
  fs.mkdirSync(path.dirname(sock), { recursive: true });
  try { fs.rmSync(sock, { force: true }); } catch {}
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (d) => {
      buf += d;
      if (buf.indexOf('\n') === -1) return;
      conn.end(JSON.stringify(reply) + '\n');
    });
    conn.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(sock, () => resolve(server)));
}

test('queryInject returns null when socket absent', async () => {
  const root = tmpRoot();
  const res = await queryInject(root, { query: 'anything' }, 300);
  assert.strictEqual(res, null);
});

test('queryInject round-trips against a stub server', async () => {
  const root = tmpRoot();
  const reply = { hits: [{ path: 'docs/a.md', startLine: 3, heading: 'H', snippet: 's', score: 0.9 }], injected: true };
  const server = await startStub(root, reply);
  try {
    const res = await queryInject(root, { query: 'how to configure', limit: 3, threshold: 0 }, 500);
    assert.deepStrictEqual(res, reply);
  } finally {
    server.close();
  }
});

test('formatBlock renders path:line and read_doc guidance', () => {
  const out = formatBlock([{ path: 'docs/a.md', startLine: 12, heading: 'Setup', snippet: 'text' }]);
  assert.match(out, /docs\/a\.md:12/);
  assert.match(out, /read_doc/);
  assert.match(out, /Setup/);
});

test('formatBlock returns empty string for no hits', () => {
  assert.strictEqual(formatBlock([]), '');
  assert.strictEqual(formatBlock(null), '');
});
