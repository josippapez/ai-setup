'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { injectSocketPath, queryInject, formatBlock, isConversationalFiller, filterFreshHits, statePath, loadState } = require('./inject-client.cjs');

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
  assert.match(out, /Relevant local documentation — consult these with read_doc before relying on general knowledge/);
});

test('formatBlock returns empty string for no hits', () => {
  assert.strictEqual(formatBlock([]), '');
  assert.strictEqual(formatBlock(null), '');
});

test('isConversationalFiller true for unmistakable filler', () => {
  for (const t of ['hello', 'thanks that looks good', 'ok', 'lgtm', 'hey there thanks']) {
    assert.strictEqual(isConversationalFiller(t), true, `expected filler: ${t}`);
  }
});

test('isConversationalFiller false for real questions/content', () => {
  for (const t of ['how does auth work', 'what are the orchestration rules', 'explain the injection socket']) {
    assert.strictEqual(isConversationalFiller(t), false, `expected not filler: ${t}`);
  }
});

const hit = (p) => ({ path: p, startLine: 1, snippet: 's' });

test('filterFreshHits suppresses a doc already injected this session', () => {
  const root = tmpRoot();
  assert.deepStrictEqual(filterFreshHits(root, 's1', [hit('a.md')]).map((h) => h.path), ['a.md']);
  assert.deepStrictEqual(filterFreshHits(root, 's1', [hit('a.md')]), []);
});

test('filterFreshHits passes through docs not seen before', () => {
  const root = tmpRoot();
  filterFreshHits(root, 's1', [hit('a.md')]);
  assert.deepStrictEqual(filterFreshHits(root, 's1', [hit('a.md'), hit('b.md')]).map((h) => h.path), ['b.md']);
});

test('filterFreshHits re-allows a doc once the tick window has passed', () => {
  const root = tmpRoot();
  filterFreshHits(root, 's1', [hit('a.md')], 3);
  assert.deepStrictEqual(filterFreshHits(root, 's1', [hit('a.md')], 3), []);
  filterFreshHits(root, 's1', [hit('x.md')], 3);
  assert.deepStrictEqual(filterFreshHits(root, 's1', [hit('a.md')], 3).map((h) => h.path), ['a.md']);
});

test('filterFreshHits keeps sessions independent', () => {
  const root = tmpRoot();
  filterFreshHits(root, 's1', [hit('a.md')]);
  assert.deepStrictEqual(filterFreshHits(root, 's2', [hit('a.md')]).map((h) => h.path), ['a.md']);
});

test('filterFreshHits reads a v1 array state without resurfacing everything', () => {
  const root = tmpRoot();
  const sp = statePath(root, 's1');
  fs.mkdirSync(path.dirname(sp), { recursive: true });
  fs.writeFileSync(sp, JSON.stringify(['old.md']));
  assert.deepStrictEqual(filterFreshHits(root, 's1', [hit('old.md')], 20), []);
  assert.strictEqual(loadState(sp).tick, 1);
});

test('filterFreshHits is fail-safe when the state dir cannot be written', () => {
  assert.deepStrictEqual(filterFreshHits('/proc/nonexistent-root', 's1', [hit('a.md')]).map((h) => h.path), ['a.md']);
});
