'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createIndex, addChunks, hybridSearch, saveRecords, readRecords, loadIndex, packVector, unpackVector, EMBED_DIM } = require('./doc-index.cjs');
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
  const back = await readRecords(tmp);
  assert.deepStrictEqual(back.map(r => r.path), ['auth.md', 'build.md']);
  assert.strictEqual(cosine(back[0].embedding, records[0].embedding) > 0.999, true);
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
  assert.ok(Math.abs(back[7].embedding[0] - 0.123456789) < 0.005);
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

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return dot / Math.sqrt(na * nb);
}

test('int8 packing keeps cosine above 0.999 and is a quarter of the Float32 size', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const v = Array.from({ length: EMBED_DIM }, () => rand() * 0.2);
  assert.ok(cosine(unpackVector(packVector(v)), v) > 0.999);
  assert.ok(packVector(v).length < Buffer.from(Float32Array.from(v).buffer).toString('base64').length * 0.28);
});

test('an index written with Float32 vectors still loads', async () => {
  const v = Array.from({ length: EMBED_DIM }, (_, k) => k / EMBED_DIM);
  const f32 = Buffer.from(Float32Array.from(v).buffer).toString('base64');
  assert.deepStrictEqual(unpackVector(f32), Array.from(Float32Array.from(v)));
  const tmp = path.join(os.tmpdir(), `di-old-${process.pid}.jsonl`);
  fs.writeFileSync(tmp, `${JSON.stringify({ path: 'a.md', heading: 'A', content: 'x', startLine: 1, mtime: 1, embedding: f32, ctxEmbedding: f32 })}\n`);
  const [rec] = await readRecords(tmp);
  assert.deepStrictEqual(rec.embedding, Array.from(Float32Array.from(v)));
});
