'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Stub the semantic search so each test decides what it returns, without models.
let rankDocsImpl = async () => null;
const searchPath = require.resolve('../lib/doc-search.cjs');
require.cache[searchPath] = { id: searchPath, filename: searchPath, loaded: true, exports: { rankDocs: (...args) => rankDocsImpl(...args) } };
const { findDocsTool } = require('./find-docs.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finddocs-'));
fs.mkdirSync(path.join(root, 'docs'));
fs.writeFileSync(path.join(root, 'docs', 'routing.md'), '# Routing\nHow routes and loaders work.\n');
const ctx = { root, maxFileSizeBytes: 512 * 1024 };
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('falls back to the keyword scorer when semantic search is unavailable', async () => {
  rankDocsImpl = async () => null;
  const out = await findDocsTool.execute({ query: 'routing' }, ctx);
  assert.strictEqual(out, 'docs "routing" (keyword fallback, semantic index not ready); 1) docs/routing.md:1 — # Routing');
});

test('falls back when semantic search throws, e.g. runtime deps still installing', async () => {
  rankDocsImpl = async () => { throw new Error('Cannot find module @orama/orama'); };
  assert.match(await findDocsTool.execute({ query: 'routing' }, ctx), /^docs "routing" \(keyword fallback/);
});

test('uses the semantic results when there are any, and says so when nothing matches', async () => {
  rankDocsImpl = async () => [{ path: 'docs/routing.md', heading: 'Routing', content: 'How routes work.', startLine: 1, score: 0.9 }];
  assert.strictEqual(await findDocsTool.execute({ query: 'routing' }, ctx), 'docs "routing"; 1) docs/routing.md:1 › Routing — How routes work.');
  rankDocsImpl = async () => [];
  assert.strictEqual(await findDocsTool.execute({ query: 'routing' }, ctx), 'No docs for "routing".');
});
