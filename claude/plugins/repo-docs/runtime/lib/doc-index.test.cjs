'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createIndex, addChunks, hybridSearch, saveRecords, readRecords, loadIndex, EMBED_DIM } = require('./doc-index.cjs');
const { skipWithoutRuntimeDeps } = require('./test-runtime-deps.cjs');
const skip = skipWithoutRuntimeDeps();

const vec = (i) => Array.from({ length: EMBED_DIM }, (_, k) => (k === i ? 1 : 0));

test('hybrid search finds a doc by keyword and by vector, saves and loads', { skip }, async () => {
  const records = [
    { path: 'auth.md', heading: 'Auth', content: 'login session token guide', startLine: 3, mtime: 1, embedding: vec(0), ctxEmbedding: vec(2) },
    { path: 'build.md', heading: 'Build', content: 'compile bundle webpack', startLine: 1, mtime: 1, embedding: vec(1), ctxEmbedding: vec(3) },
  ]
  const db = await createIndex();
  // Orama takes the vectors out of the documents it is handed, so it gets copies.
  await addChunks(db, records.map(r => ({ ...r })));
  const byTerm = await hybridSearch(db, { term: 'session token', vector: vec(0), limit: 5 });
  assert.strictEqual(byTerm[0].path, 'auth.md');
  assert.strictEqual(byTerm[0].heading, 'Auth');

  const tmp = path.join(os.tmpdir(), `di-${process.pid}.jsonl`);
  await saveRecords(records, tmp);
  assert.deepStrictEqual(await readRecords(tmp), records);
  const db2 = await loadIndex(tmp);
  assert.ok(db2);
  assert.strictEqual((await hybridSearch(db2, { term: 'webpack', vector: vec(1), limit: 5 }))[0].path, 'build.md');
  fs.rmSync(tmp, { force: true });
});

test('vectors are stored packed, so the file stays near the size of its text', async () => {
  const content = 'x'.repeat(1000);
  const records = Array.from({ length: 50 }, (_, i) => ({ path: `d${i}.md`, heading: 'H', content, startLine: 1, mtime: 1, embedding: vec(i).map(n => n + 0.123456789), ctxEmbedding: vec(i) }));
  const tmp = path.join(os.tmpdir(), `di-size-${process.pid}.jsonl`);
  await saveRecords(records, tmp);
  // Two 384-float vectors as base64 Float32 are 4 KB a chunk; as JSON text they were ~15 KB.
  assert.ok(fs.statSync(tmp).size < 50 * (1000 + 4200), `${fs.statSync(tmp).size} bytes`);
  const back = await readRecords(tmp);
  assert.strictEqual(back[7].embedding[0], Math.fround(0.123456789));
  fs.rmSync(tmp, { force: true });
});

test('an index from the old Orama export reads as no index instead of throwing', async () => {
  const tmp = path.join(os.tmpdir(), `di-old-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ internalDocumentIDStore: {}, docs: { docs: {} } }));
  assert.strictEqual(await readRecords(tmp), null);
  fs.rmSync(tmp, { force: true });
});

test('loadIndex returns null for a missing file', { skip }, async () => {
  assert.strictEqual(await loadIndex('/no/such/index.msp'), null);
});
