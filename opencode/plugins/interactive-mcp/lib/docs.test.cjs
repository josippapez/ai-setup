'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { getDocFiles } = require('./docs.cjs');

function write(root, relativePath, content = '# Test\n') {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('indexes Markdown across the repository and honors repo-docs-ignore', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-docs-'));
  write(root, 'README.md');
  write(root, 'notes/decision.mdx');
  write(root, 'generated/report.md');
  write(root, 'src/code.js', 'export {}\n');
  write(root, '.opencode/repo-docs-ignore', 'generated\n');

  const files = getDocFiles({ root }).map((file) => path.relative(root, file)).sort();
  assert.deepStrictEqual(files, ['README.md', 'notes/decision.mdx']);
});
