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
  _orama = await import(pathToFileURL(req.resolve('@orama/orama')).href);
  return _orama;
}

// NOTE: Orama v3 create/insertMultiple/search are synchronous.
// Confirmed in Task 1 smoke test — adjust if the installed version differs.
function createIndex(o) {
  return o.create({
    // mtime powers the incremental cache in build-semantic-index.cjs (not returned
    // by hybridSearch — callers don't need it).
    // embedding is the chunk text alone; ctxEmbedding adds the doc path and heading
    // breadcrumb, so a chunk also matches questions about what its doc is for.
    schema: { path: 'string', heading: 'string', content: 'string', startLine: 'number', mtime: 'number', embedding: `vector[${EMBED_DIM}]`, ctxEmbedding: `vector[${EMBED_DIM}]` },
  });
}

function addChunks(o, db, records) {
  o.insertMultiple(db, records);
}

function hybridSearch(o, db, { term, vector, property = 'embedding', limit = 30 }) {
  const res = o.search(db, {
    mode: 'hybrid',
    term,
    vector: { value: vector, property },
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

// The index file holds the chunk records, one JSON line each, with both vectors as
// base64 Float32. Orama's own JSON export wrote every float as text plus its search
// trees: a 4 MB doc set became a 697 MB file, past the ~512 MB string Node can read
// back, so every load failed and every build re-embedded everything. Lines are read
// one at a time, so no single string grows with the corpus; a load rebuilds the
// search index from the records, which costs no embedding.
const packVector = v => Buffer.from(Float32Array.from(v).buffer).toString('base64');
function unpackVector(text) {
  const bytes = Buffer.from(text, 'base64');
  return Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4));
}

// Atomic write: write a per-process temp file, then rename it over the target.
// rename() is atomic on the same filesystem, so a concurrent reader (another MCP
// server's loadIndex, or the build's prior-record cache) never sees a half-written
// index, which would read as "no cache" and trigger a full re-embed.
function saveRecords(records, filePath) {
  const fs = require('node:fs');
  const tmp = `${filePath}.tmp.${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    for (const { embedding, ctxEmbedding, ...rest } of records) {
      fs.writeSync(fd, `${JSON.stringify({ ...rest, embedding: packVector(embedding), ctxEmbedding: packVector(ctxEmbedding) })}\n`);
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

// Resolves the records, or null when the file is missing or is not in this format.
async function readRecords(filePath) {
  const fs = require('node:fs');
  const readline = require('node:readline');
  if (!fs.existsSync(filePath)) return null;
  const records = [];
  try {
    for await (const line of readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity })) {
      if (!line) continue;
      const rec = JSON.parse(line);
      records.push({ ...rec, embedding: unpackVector(rec.embedding), ctxEmbedding: unpackVector(rec.ctxEmbedding) });
    }
  } catch {
    return null;
  }
  return records;
}

// Public async wrappers that resolve the ESM module first.
module.exports = {
  EMBED_DIM,
  createIndex: () => orama().then(createIndex),
  addChunks: (db, records) => orama().then(o => addChunks(o, db, records)),
  hybridSearch: (db, args) => orama().then(o => hybridSearch(o, db, args)),
  saveRecords: async (records, filePath) => saveRecords(records, filePath),
  readRecords,
  loadIndex: async (filePath) => {
    const records = await readRecords(filePath);
    if (!records) return null;
    const o = await orama();
    const db = createIndex(o);
    addChunks(o, db, records);
    return db;
  },
};
