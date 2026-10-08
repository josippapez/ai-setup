'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Stub the embedder, the index and the ranking so each test decides what they return.
let ready = false;
let status = { state: 'failed', error: "Cannot find module '@huggingface/transformers'", retryInMs: 12000 };
let ranked = [];
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/semantic-index.cjs', { waitUntilReady: async () => ready, embedderStatus: () => status });
stub('../lib/doc-index.cjs', { loadIndex: async () => null });
stub('../lib/doc-search.cjs', { rankDocs: async () => ranked, CAND: 60 });
const { findDocsTool } = require('./find-docs.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finddocs-'));
fs.mkdirSync(path.join(root, 'docs'));
fs.writeFileSync(path.join(root, 'docs', 'routing.md'), '# Routing\nHow routes and loaders work.\n');
const ctx = { root, maxFileSizeBytes: 512 * 1024 };
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('an embedder that failed to load gets keyword results, the reason, and when to retry', async () => {
  ready = false;
  assert.strictEqual(
    await findDocsTool.execute({ query: 'routing' }, ctx),
    "docs \"routing\" (keyword fallback: embedding model failed to load (Cannot find module '@huggingface/transformers'); retry find_docs in 12s)\n1) docs/routing.md:1 — # Routing",
  );
  status = { state: 'loading', forMs: 6000 };
  assert.strictEqual(await findDocsTool.execute({ query: 'zzz' }, ctx), 'No docs for "zzz" (keyword fallback: embedding model still loading after 6s; retry find_docs in 30s).');
});

test('no index yet gets keyword results; semantic hits come one per line', async () => {
  ready = true;
  ranked = [];
  assert.match(await findDocsTool.execute({ query: 'routing' }, ctx), /^docs "routing" \(keyword fallback: semantic index not built yet; .*\)\n1\) docs\/routing\.md:1/);
  ranked = [{ path: 'docs/a.md', heading: 'A', content: 'First.', startLine: 1 }, { path: 'docs/b.md', heading: 'B', content: 'Second.', startLine: 4 }];
  assert.strictEqual(await findDocsTool.execute({ query: 'routing' }, ctx), 'docs "routing"\n1) docs/a.md:1 › A — First.\n2) docs/b.md:4 › B — Second.');
});
