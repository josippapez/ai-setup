'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { keywordSearch } = require('./keyword-search.cjs');

function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwsearch-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return { root, maxFileSizeBytes: 512 * 1024 };
}

test('ranks a doc whose path and title match above one that only mentions the term', (t) => {
  const ctx = makeRepo({
    'docs/routing.md': '# Routing\nHow routes and loaders work.\n',
    'docs/other.md': '# Other\nSomething else that mentions routing once.\n',
  });
  t.after(() => fs.rmSync(ctx.root, { recursive: true, force: true }));
  const hits = keywordSearch(ctx, 'routing', 5);
  assert.deepStrictEqual(hits.map(h => h.path), ['docs/routing.md', 'docs/other.md']);
  assert.strictEqual(hits[0].lineNumber, 1);
  assert.strictEqual(hits[0].snippet, '# Routing');
});

test('ignores stop words, and returns nothing for a query with no matching token', (t) => {
  const ctx = makeRepo({ 'docs/a.md': '# A\nthe of and\n' });
  t.after(() => fs.rmSync(ctx.root, { recursive: true, force: true }));
  assert.deepStrictEqual(keywordSearch(ctx, 'how does webpack work', 5), []);
});

test('the standards bonus lifts a standards doc for a conventions query', (t) => {
  const ctx = makeRepo({
    'docs/standards/naming.md': '# Naming\nNaming convention for files.\n',
    'docs/notes/naming.md': '# Naming\nNaming convention for files.\n',
  });
  t.after(() => fs.rmSync(ctx.root, { recursive: true, force: true }));
  assert.strictEqual(keywordSearch(ctx, 'naming convention', 5)[0].path, 'docs/standards/naming.md');
});
