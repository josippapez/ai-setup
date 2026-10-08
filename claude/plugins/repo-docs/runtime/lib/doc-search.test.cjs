'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Stub the cross-encoder so these tests never load it; record how it is called.
const rerankCalls = [];
const rerankerPath = require.resolve('./reranker.cjs');
require.cache[rerankerPath] = {
  id: rerankerPath, filename: rerankerPath, loaded: true,
  exports: { isRerankEnabled: () => true, rerank: async (q, candidates) => { rerankCalls.push(candidates.length); return candidates.map((_, i) => i).reverse(); } },
};

const { warmUp, waitUntilReady, embedDocument, shutdown } = require('./semantic-index.cjs');
const { saveRecords } = require('./doc-index.cjs');
const { rankDocs, fuseRankings, unavailableReason } = require('./doc-search.cjs');
const { skipWithoutRuntimeDeps } = require('./test-runtime-deps.cjs');
const skip = skipWithoutRuntimeDeps();

async function makeIndex(docs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docsearch-'));
  fs.mkdirSync(path.join(root, '.claude', 'repo-docs'), { recursive: true });
  const records = [];
  for (const d of docs) {
    records.push({ ...d, startLine: 1, mtime: 1, embedding: await embedDocument(d.content), ctxEmbedding: await embedDocument(`${d.path} › ${d.heading}\n${d.content}`) });
  }
  await saveRecords(records, path.join(root, '.claude', 'repo-docs', 'repo-docs-index.json'));
  return { root, maxFileSizeBytes: 1e6 };
}

test('fuseRankings orders files by reciprocal rank and keeps each file\'s best-ranked chunk', () => {
  const a1 = { path: 'a' }, b1 = { path: 'b' }, c1 = { path: 'c' };
  const b2 = { path: 'b' }, c2 = { path: 'c' }, a2 = { path: 'a' };
  const fused = fuseRankings([[a1, b1, c1], [b2, c2, a2]]);
  assert.deepStrictEqual(fused.map(h => h.path), ['b', 'a', 'c']);
  assert.strictEqual(fused[0], b2, 'b keeps the chunk from the list that ranked it first');
  assert.strictEqual(fused[1], a1);
});

test('rankDocs returns one best hit per file', { skip }, async (t) => {
  warmUp();
  assert.ok(await waitUntilReady(), 'embedder must warm up');
  t.after(() => shutdown());
  const context = await makeIndex([
    { path: 'docs/auth.md', heading: 'Auth', content: '# Auth\nHow token refresh and login sessions work in this project.' },
    { path: 'docs/auth.md', heading: 'Auth › Details', content: 'More about login token refresh and session expiry.' },
    { path: 'docs/build.md', heading: 'Build', content: '# Build\nWebpack bundling and CI pipeline stages.' },
  ]);
  const hits = await rankDocs(context, { query: 'how does login token refresh work', limit: 5, rerank: false });
  assert.deepStrictEqual(hits.map(h => h.path), ['docs/auth.md', 'docs/build.md']);
  assert.ok(typeof hits[0].score === 'number');
});

test('the cross-encoder votes on the top candidates by default and is skipped with rerank:false', { skip }, async (t) => {
  warmUp();
  assert.ok(await waitUntilReady(), 'embedder must warm up');
  t.after(() => shutdown());
  const context = await makeIndex([
    { path: 'docs/auth.md', heading: 'Auth', content: '# Auth\nHow token refresh and login sessions work.' },
    { path: 'docs/build.md', heading: 'Build', content: '# Build\nWebpack bundling and CI pipeline stages.' },
    { path: 'docs/deploy.md', heading: 'Deploy', content: '# Deploy\nReleasing to staging and production.' },
  ]);
  rerankCalls.length = 0;
  const skipped = await rankDocs(context, { query: 'login token refresh', limit: 5, rerank: false });
  assert.deepStrictEqual(rerankCalls, [], 'rerank:false must not call the cross-encoder');
  const voted = await rankDocs(context, { query: 'login token refresh', limit: 5 });
  assert.deepStrictEqual(rerankCalls, [3], 'one vote over every candidate when there are fewer than 10');
  assert.deepStrictEqual(new Set(voted.map(h => h.path)), new Set(skipped.map(h => h.path)));
});

test('rankDocs picks up a rebuilt index without a restart', { skip }, async (t) => {
  warmUp();
  assert.ok(await waitUntilReady(), 'embedder must warm up');
  t.after(() => shutdown());
  const context = await makeIndex([{ path: 'docs/widgets.md', heading: 'Widgets', content: '# Widgets\nEverything about widget configuration.' }]);
  assert.strictEqual((await rankDocs(context, { query: 'widget configuration', rerank: false }))[0].path, 'docs/widgets.md');

  const rebuilt = await makeIndex([{ path: 'docs/gadgets.md', heading: 'Gadgets', content: '# Gadgets\nEverything about gadget configuration.' }]);
  const file = path.join(context.root, '.claude', 'repo-docs', 'repo-docs-index.json');
  fs.copyFileSync(path.join(rebuilt.root, '.claude', 'repo-docs', 'repo-docs-index.json'), file);
  // A strictly newer mtime than the cached one, whatever the filesystem's resolution.
  const bumped = new Date(fs.statSync(file).mtimeMs + 2000);
  fs.utimesSync(file, bumped, bumped);
  assert.strictEqual((await rankDocs(context, { query: 'gadget configuration', rerank: false }))[0].path, 'docs/gadgets.md', 'must see the rebuilt index, not a stale cached one');
});

// A server whose embedder failed to start (deps still installing) has no worker until a
// query spawns one. That first query used to answer with keyword search while the model
// loaded in under a second; it now waits for the load.
test('the first query after the embedder stopped waits for it to load instead of falling back', { skip }, async () => {
  warmUp();
  assert.ok(await waitUntilReady(), 'embedder must warm up');
  const context = await makeIndex([{ path: 'docs/cache.md', heading: 'Cache', content: '# Cache\nWhere cached server data may be stored.' }]);
  await shutdown();
  const hits = await rankDocs(context, { query: 'where is cached server data stored', rerank: false });
  await shutdown();
  assert.deepStrictEqual(hits && hits.map(h => h.path), ['docs/cache.md']);
});

test('unavailableReason says when a retry gets semantic results', { skip }, async (t) => {
  warmUp();
  assert.ok(await waitUntilReady(), 'embedder must warm up');
  t.after(() => shutdown());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docsearch-'));
  const context = { root, maxFileSizeBytes: 1e6 };
  assert.match(unavailableReason(context), /not built yet; run \/repo-docs:reindex, then retry find_docs/);
  const dir = path.join(root, '.claude', 'repo-docs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index-build.lock'), String(process.pid));
  fs.writeFileSync(path.join(dir, 'index-build.progress'), '0 40');
  assert.match(unavailableReason(context), /building \(0 of 40 docs embedded\); retry find_docs when it finishes/);
  // 10 docs in 20 s leaves 30 docs, about 60 s.
  const started = new Date(Date.now() - 20000);
  fs.utimesSync(path.join(dir, 'index-build.lock'), started, started);
  fs.writeFileSync(path.join(dir, 'index-build.progress'), '10 40');
  assert.match(unavailableReason(context), /10 of 40 docs embedded, about 6\ds left/);
  assert.match(unavailableReason(context, new Error("Cannot find module '@orama/orama'")), /failed to start \(Cannot find module '@orama\/orama'\); retry find_docs in 30s/);
});

test('rankDocs resolves null when no index exists, so find_docs can fall back', { skip }, async (t) => {
  warmUp();
  assert.ok(await waitUntilReady(), 'embedder must warm up');
  t.after(() => shutdown());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docsearch-'));
  assert.strictEqual(await rankDocs({ root, maxFileSizeBytes: 1e6 }, { query: 'anything', rerank: false }), null);
  assert.deepStrictEqual(await rankDocs({ root, maxFileSizeBytes: 1e6 }, { query: '   ' }), []);
});
