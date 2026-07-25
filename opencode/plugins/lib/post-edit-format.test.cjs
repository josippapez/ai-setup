'use strict';

const assert = require('node:assert');
const { test } = require('node:test');
const { collectEditedFiles, filesFromPatch } = require('./post-edit-format.cjs');

test('extracts files from apply_patch envelopes', () => {
  const files = filesFromPatch('*** Update File: src/app.ts\n*** Add File: docs/guide.md\n');
  assert.deepStrictEqual([...files], ['src/app.ts', 'docs/guide.md']);
});

test('collects direct and batched edit paths', () => {
  const files = collectEditedFiles({
    tool: 'multiedit',
    args: { filePath: 'src/a.ts', edits: [{ path: 'src/b.ts' }] },
  });
  assert.deepStrictEqual(files, ['src/a.ts', 'src/b.ts']);
});

test('ignores non-edit tools', () => {
  assert.deepStrictEqual(collectEditedFiles({ tool: 'read', args: { path: 'src/a.ts' } }), []);
});
