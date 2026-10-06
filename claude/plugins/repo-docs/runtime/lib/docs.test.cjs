'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDocFiles } = require('./docs.cjs');

function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-docs-docs-'));
  for (const rel of files) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), '# doc\n');
  }
  return root;
}
const listed = (root) => getDocFiles({ root }).map((f) => path.relative(root, f).split(path.sep).join('/')).sort();

test('default ignores drop CocoaPods vendor dirs, Expo caches and reports without an ignore file', () => {
  const root = makeRepo([
    'README.md',
    'apps/intouch/README.md',
    'apps/intouch/ios/Pods/Foo/README.md',
    'ios/Pods/Bar/README.md',
    'apps/intouch/ios/README.md',
    'apps/intouch/.expo/README.md',
    'reports/guidance-audit.md',
    'docs/guide.md',
  ]);
  assert.deepStrictEqual(listed(root), ['README.md', 'apps/intouch/README.md', 'apps/intouch/ios/README.md', 'docs/guide.md']);
});

test('the ignore file adds to the defaults', () => {
  const root = makeRepo(['docs/guide.md', 'evidence/report.md', 'reports/a.md']);
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude', 'repo-docs-ignore'), '# generated\nevidence\n');
  assert.deepStrictEqual(listed(root), ['docs/guide.md']);
});
