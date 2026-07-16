'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { warmUp, waitUntilReady, embedDocument, shutdown } = require('./semantic-index.cjs');
const { createIndex, addChunks, saveIndex } = require('./doc-index.cjs');
const { rankDocs } = require('./doc-search.cjs');

test('rankDocs returns hits above threshold, collapsed one-per-file', async () => {
  warmUp();
  const ready = await waitUntilReady();
  assert.ok(ready, 'embedder must warm up');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docsearch-'));
  const root = dir;
  fs.mkdirSync(path.join(root, '.claude', 'repo-docs'), { recursive: true });
  const db = await createIndex();
  const text = '# Auth\nHow token refresh and login sessions work in this project.';
  const emb = await embedDocument(text);
  await addChunks(db, [{ path: 'docs/auth.md', heading: 'Auth', content: text, startLine: 1, mtime: 1, embedding: emb }]);
  await saveIndex(db, path.join(root, '.claude', 'repo-docs', 'repo-docs-index.json'));

  const context = { root, maxFileSizeBytes: 1e6 };
  const hits = await rankDocs(context, { query: 'how does login token refresh work', limit: 3, threshold: 0 });
  assert.ok(hits.length >= 1, 'expected at least one hit');
  assert.strictEqual(hits[0].path, 'docs/auth.md');
  assert.ok(typeof hits[0].score === 'number');
  await shutdown();
});
