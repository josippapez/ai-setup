'use strict';

const { loadIndex, hybridSearch } = require('./doc-index.cjs');
const { isReady, embedQuery } = require('./semantic-index.cjs');
const { indexPath } = require('../tools/build-semantic-index.cjs');

const CAND = 60;

// Shared ranking core for find_docs and the injection socket: embed the query,
// hybrid-search, filter by threshold, then (unless collapse:false) collapse to
// the best chunk per file, and cap. collapse:false is for callers (the find_docs
// rerank path) that need to rerank the raw threshold-filtered candidates first
// and collapse afterwards, matching the original pre-rerank ordering semantics.
async function rankDocs(context, { query, limit = 12, threshold = 0, collapse = true } = {}) {
  const q = String(query || '').trim();
  if (!q || !isReady()) return [];
  const db = await loadIndex(indexPath(context));
  if (!db) return [];
  const qvec = await embedQuery(q);
  if (!qvec) return [];

  const hits = await hybridSearch(db, { term: q, vector: qvec, limit: CAND });
  if (!collapse) {
    return hits.filter((h) => h.score >= threshold).slice(0, limit);
  }
  const seen = new Set();
  const files = [];
  for (const h of hits) {
    if (h.score < threshold) continue;
    if (seen.has(h.path)) continue;
    seen.add(h.path);
    files.push(h);
    if (files.length >= limit) break;
  }
  return files;
}

module.exports = { rankDocs, CAND };
