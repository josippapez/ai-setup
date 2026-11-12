'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readDocTool } = require('./read-doc.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readdoc-'));
const ctx = { root, maxFileSizeBytes: 64 };
const text = '# Title\n\nSee [docs](https://x.dev).\n';
fs.writeFileSync(path.join(root, 'a.md'), text);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('returns the raw file by default so find_docs line numbers line up', () => {
  assert.strictEqual(readDocTool.execute({ path: 'a.md' }, ctx), text);
});

test('compact:true returns the minified rendering', () => {
  assert.strictEqual(readDocTool.execute({ path: 'a.md', compact: true }, ctx), 'Title See docs .');
});

test('rejects paths outside the root and files over the size cap', () => {
  assert.strictEqual(readDocTool.execute({ path: '../etc/passwd' }, ctx), 'Path is outside the repository root.');
  fs.writeFileSync(path.join(root, 'big.md'), 'x'.repeat(100));
  assert.match(readDocTool.execute({ path: 'big.md' }, ctx), /^File too large/);
});

// A cloned repo can ship a link that points outside it.
test('rejects a symlink inside the repo that leads outside it', (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'readdoc-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'secret.md'), 'OUTSIDE SECRET');
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'leak.md'));
  fs.symlinkSync(outside, path.join(root, 'leakdir'));
  assert.strictEqual(readDocTool.execute({ path: 'leak.md' }, ctx), 'Path is outside the repository root.');
  assert.strictEqual(readDocTool.execute({ path: 'leakdir/secret.md' }, ctx), 'Path is outside the repository root.');
  fs.symlinkSync(path.join(root, 'a.md'), path.join(root, 'alias.md'));
  assert.strictEqual(readDocTool.execute({ path: 'alias.md' }, ctx), text, 'a link to a file inside the repo still reads');
});
