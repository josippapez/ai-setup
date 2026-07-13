'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createIndex, addChunks, hybridSearch, saveIndex, loadIndex, EMBED_DIM } = require('./doc-index.cjs');

const vec = (i) => Array.from({ length: EMBED_DIM }, (_, k) => (k === i ? 1 : 0));

test('hybrid search finds a doc by keyword and by vector, persists and restores', async () => {
  const db = await createIndex();
  await addChunks(db, [
    { path: 'auth.md', heading: 'Auth', content: 'login session token guide', startLine: 3, embedding: vec(0) },
    { path: 'build.md', heading: 'Build', content: 'compile bundle webpack', startLine: 1, embedding: vec(1) },
  ]);
  const byTerm = await hybridSearch(db, { term: 'session token', vector: vec(0), limit: 5 });
  assert.strictEqual(byTerm[0].path, 'auth.md');
  assert.strictEqual(byTerm[0].heading, 'Auth');

  const tmp = path.join(os.tmpdir(), `di-${process.pid}.msp`);
  await saveIndex(db, tmp);
  const db2 = await loadIndex(tmp);
  assert.ok(db2);
  assert.strictEqual((await hybridSearch(db2, { term: 'webpack', vector: vec(1), limit: 5 }))[0].path, 'build.md');
  fs.rmSync(tmp, { force: true });
});

test('loadIndex returns null for a missing file', async () => {
  assert.strictEqual(await loadIndex('/no/such/index.msp'), null);
});
