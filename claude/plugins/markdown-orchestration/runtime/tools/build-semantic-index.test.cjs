'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createContext } = require('../lib/context.cjs');
const { shutdown } = require('../lib/semantic-index.cjs');
const { buildDocIndex } = require('./build-semantic-index.cjs');
const { skipWithoutRuntimeDeps } = require('../lib/test-runtime-deps.cjs');
const skip = skipWithoutRuntimeDeps();

function makeRepo(fileCount) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-semantic-index-'));
  for (let i = 0; i < fileCount; i++) {
    fs.writeFileSync(path.join(root, `doc${i}.md`), `# Doc ${i}\ncontent for doc ${i}\n`);
  }
  return root;
}

// The incremental-cache tests force each build to bypass the debounce window
// (they intentionally rebuild twice back-to-back to exercise the mtime cache).
test('second build reuses unchanged files and only re-embeds a touched one', { skip }, async (t) => {
  const root = makeRepo(4);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); shutdown(); });
  const context = createContext(root);

  const first = await buildDocIndex(context, { force: true });
  assert.strictEqual(first.updated, 4);
  assert.strictEqual(first.unchanged, 0);
  assert.strictEqual(first.skipped, 0);

  const touched = path.join(root, 'doc0.md');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(touched, future, future);
  fs.writeFileSync(touched, '# Doc 0\nUPDATED content for doc 0\n');

  const second = await buildDocIndex(context, { force: true });
  assert.strictEqual(second.updated, 1, 'only the touched file should be re-embedded');
  assert.strictEqual(second.unchanged, 3, 'the other files should be reused from cache');
  assert.strictEqual(second.skipped, 0);
});

test('a pre-v2 (mtime-less) index triggers a full rebuild instead of crashing', { skip }, async (t) => {
  const root = makeRepo(2);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); shutdown(); });
  const context = createContext(root);

  const first = await buildDocIndex(context, { force: true });
  assert.strictEqual(first.updated, 2);

  const dir = path.join(root, '.claude', 'repo-docs');
  fs.writeFileSync(path.join(dir, 'repo-docs-index.meta.json'), JSON.stringify({ schemaVersion: 1 }));

  const second = await buildDocIndex(context, { force: true });
  assert.strictEqual(second.updated, 2, 'stale schema version must force a full rebuild, not a crash');
  assert.strictEqual(second.unchanged, 0);
});

test('a rapid unforced rebuild is debounced (no re-embed)', { skip }, async (t) => {
  const root = makeRepo(2);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); shutdown(); });
  const context = createContext(root);

  const first = await buildDocIndex(context, { force: true });
  assert.strictEqual(first.updated, 2);

  // Immediate second build with no force → within the debounce window → skipped.
  const second = await buildDocIndex(context);
  assert.strictEqual(second.debounced, true, 'a rebuild within the debounce window should be skipped');
  assert.strictEqual(second.updated, 0);
  assert.strictEqual(second.unchanged, 0);
});

test('a held build lock makes a concurrent build back off (single-writer guard)', { skip }, async (t) => {
  const root = makeRepo(2);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); shutdown(); });
  const context = createContext(root);

  // Simulate another process mid-build: a fresh lock file + no debounce stamp.
  const dir = path.join(root, '.claude', 'repo-docs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index-build.lock'), '999999');

  // force bypasses debounce but must NOT bypass the lock.
  const res = await buildDocIndex(context, { force: true });
  assert.strictEqual(res.locked, true, 'a build must back off when the lock is held');
  assert.strictEqual(res.updated, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'repo-docs-index.json')), 'no index should be written while locked');
});
