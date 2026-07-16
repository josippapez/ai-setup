'use strict';

const EMBED_DIM = 384;
let _orama = null;

async function orama() {
  if (_orama) return _orama;
  // NODE_PATH is honored by CJS require.resolve but NOT by ESM import(); resolve
  // absolute entries via require, then import the file URLs (same bridge the
  // embedder worker uses for @huggingface/transformers). Task 1 confirmed this.
  const { createRequire } = require('node:module');
  const { pathToFileURL } = require('node:url');
  const req = createRequire(__filename);
  const core = await import(pathToFileURL(req.resolve('@orama/orama')).href);
  const persist = await import(pathToFileURL(req.resolve('@orama/plugin-data-persistence/server')).href);
  // The persistence package's server entry is CommonJS and its named exports are
  // not statically detected by Node's ESM/CJS interop here, so they land only on
  // `.default` (confirmed by inspection: import() yields
  // { __esModule, default, 'module.exports' } instead of named bindings).
  const persistExports = persist.persistToFile ? persist : persist.default;
  _orama = { ...core, ...persistExports };
  return _orama;
}

// NOTE: Orama v3 create/insertMultiple/search are synchronous; persist is async.
// Confirmed in Task 1 smoke test — adjust if the installed version differs.
function createIndex(o) {
  return o.create({
    // mtime powers the incremental cache in build-semantic-index.cjs (not returned
    // by hybridSearch — callers don't need it).
    schema: { path: 'string', heading: 'string', content: 'string', startLine: 'number', mtime: 'number', embedding: `vector[${EMBED_DIM}]` },
  });
}

function addChunks(o, db, records) {
  o.insertMultiple(db, records);
}

function hybridSearch(o, db, { term, vector, limit = 30 }) {
  const res = o.search(db, {
    mode: 'hybrid',
    term,
    vector: { value: vector, property: 'embedding' },
    // Vector-heavy: real-pipeline eval on a real 82-doc corpus showed 0.2/0.8 beats
    // 0.5/0.5 by +23pts hit@1 (81% vs 58%) on paraphrased queries — dense
    // similarity carries semantic intent; BM25 is a lighter exact-term boost.
    hybridWeights: { text: 0.2, vector: 0.8 },
    similarity: 0,
    limit,
  });
  return res.hits.map(h => ({
    path: h.document.path, heading: h.document.heading,
    content: h.document.content, startLine: h.document.startLine, score: h.score,
  }));
}

// Public async wrappers that resolve the ESM module first.
module.exports = {
  EMBED_DIM,
  createIndex: () => orama().then(createIndex),
  addChunks: (db, records) => orama().then(o => addChunks(o, db, records)),
  hybridSearch: (db, args) => orama().then(o => hybridSearch(o, db, args)),
  // 'json' (not 'binary'): the binary format uses msgpack (maxDepth 100), which
  // throws "Too deep objects in depth 101" when a doc contains a long unbroken
  // token (e.g. a 400-char rule/hash) — Orama's text index is a radix tree that
  // nests one level per character. JSON has no depth cap; the 1500-char chunk
  // limit bounds token depth well within JSON's limits.
  saveIndex: (db, filePath) => orama().then(o => o.persistToFile(db, 'json', filePath)),
  loadIndex: (filePath) => orama().then(async o => {
    try { const fs = require('node:fs'); if (!fs.existsSync(filePath)) return null; return await o.restoreFromFile('json', filePath); }
    catch { return null; }
  }),
};
