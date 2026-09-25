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
