'use strict';

const fs = require('node:fs');
const { loadIndex, hybridSearch } = require('./doc-index.cjs');
const { isReady, embedQuery } = require('./semantic-index.cjs');
const { rerank } = require('./reranker.cjs');
const { indexPath } = require('../tools/build-semantic-index.cjs');

// Chunk hits per vector search: deep enough that both file rankings reach well
// past the candidates the cross-encoder votes on.
const CAND = 200;
const RERANK_TOP = 10;
const RRF_K = 60;

// Loaded index cache, keyed by index path and its mtime: a query only reloads the
// index from disk when a build has actually changed it, instead of parsing it
// fresh on every call (~130 ms for a 50 MB index).
const dbCache = new Map();

async function getCachedDb(idxPath) {
  let stat;
  try { stat = fs.statSync(idxPath); } catch { dbCache.delete(idxPath); return null; }
  const cached = dbCache.get(idxPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.db;
  const db = await loadIndex(idxPath);
  if (!db) return null;
  dbCache.set(idxPath, { mtimeMs: stat.mtimeMs, db });
  return db;
}

// Best-scoring chunk per file, in rank order.
function bestPerFile(hits, threshold) {
  const seen = new Set();
  const files = [];
  for (const h of hits) {
    if (h.score < threshold || seen.has(h.path)) continue;
    seen.add(h.path);
    files.push(h);
  }
  return files;
}

// Reciprocal rank fusion of file rankings (hit lists, best first). Each file keeps
// the chunk from the list that ranked it highest.
function fuseRankings(lists) {
  const fused = new Map();
  for (const list of lists) {
    list.forEach((h, i) => {
      const cur = fused.get(h.path) || { hit: h, score: 0, best: Infinity };
      cur.score += 1 / (RRF_K + i + 1);
      if (i < cur.best) { cur.best = i; cur.hit = h; }
      fused.set(h.path, cur);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score).map(x => x.hit);
}

// Ranking core for find_docs. Plain chunk vectors match what a section says;
// context vectors (doc path and heading breadcrumb prepended) match what its doc
// is for. Their hybrid rankings are fused, then a cross-encoder votes on the top
// candidates as a third ranking. On a 40-query labelled eval each of these moved
// paraphrased questions up without moving any query down.
// Resolves null when semantic search is unavailable (model not ready, no index
// yet), so the caller can fall back to keyword search; [] means no match.
async function rankDocs(context, { query, limit = 12, threshold = 0, rerank: withRerank = true } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (!isReady()) return null;
  const db = await getCachedDb(indexPath(context));
  if (!db) return null;
  const vector = await embedQuery(q);
  if (!vector) return null;

  const ranked = async property => bestPerFile(await hybridSearch(db, { term: q, vector, property, limit: CAND }), threshold);
  const plain = await ranked('embedding');
  const withContext = await ranked('ctxEmbedding');
  let files = fuseRankings([plain, withContext]);
  if (withRerank && files.length > 1) {
    const top = files.slice(0, RERANK_TOP);
    const order = await rerank(q, top.map(h => ({ text: h.content })));
    const inTop = new Set(top.map(h => h.path));
    const voted = fuseRankings([plain, withContext, order.map(i => top[i])]).filter(h => inTop.has(h.path));
    files = [...voted, ...files.slice(RERANK_TOP)];
  }
  return files.slice(0, limit);
}

module.exports = { rankDocs, fuseRankings };
