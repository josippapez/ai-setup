'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createContext } = require('../lib/context.cjs');
const { shutdown } = require('../lib/semantic-index.cjs');
const { buildDocIndex } = require('./build-semantic-index.cjs');

function makeRepo(fileCount) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-semantic-index-'));
  for (let i = 0; i < fileCount; i++) {
    fs.writeFileSync(path.join(root, `doc${i}.md`), `# Doc ${i}\ncontent for doc ${i}\n`);
  }
  return root;
}

test('second build reuses unchanged files and only re-embeds a touched one', async (t) => {
  const root = makeRepo(4);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); shutdown(); });
  const context = createContext(root);

  const first = await buildDocIndex(context);
  assert.strictEqual(first.updated, 4);
  assert.strictEqual(first.unchanged, 0);
  assert.strictEqual(first.skipped, 0);

  // Touch one file so its mtime changes; leave the other 3 untouched.
  const touched = path.join(root, 'doc0.md');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(touched, future, future);
  fs.writeFileSync(touched, '# Doc 0\nUPDATED content for doc 0\n');

  const second = await buildDocIndex(context);
  assert.strictEqual(second.updated, 1, 'only the touched file should be re-embedded');
  assert.strictEqual(second.unchanged, 3, 'the other files should be reused from cache');
  assert.strictEqual(second.skipped, 0);
});

test('a pre-v2 (mtime-less) index triggers a full rebuild instead of crashing', async (t) => {
  const root = makeRepo(2);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); shutdown(); });
  const context = createContext(root);

  const first = await buildDocIndex(context);
  assert.strictEqual(first.updated, 2);

  // Simulate a pre-migration meta file (schemaVersion 1, no mtime field on records).
  const dir = path.join(root, '.claude', 'repo-docs');
  fs.writeFileSync(path.join(dir, 'repo-docs-index.meta.json'), JSON.stringify({ schemaVersion: 1 }));

  const second = await buildDocIndex(context);
  assert.strictEqual(second.updated, 2, 'stale schema version must force a full rebuild, not a crash');
  assert.strictEqual(second.unchanged, 0);
});
