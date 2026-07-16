'use strict';

const { loadIndex, hybridSearch } = require('./doc-index.cjs');
const { isReady, embedQuery } = require('./semantic-index.cjs');
const { indexPath } = require('../tools/build-semantic-index.cjs');

const CAND = 60;

// Shared ranking core for find_docs and the injection socket: embed the query,
// hybrid-search, collapse to the best chunk per file, filter by threshold, cap.
async function rankDocs(context, { query, limit = 12, threshold = 0 } = {}) {
  const q = String(query || '').trim();
  if (!q || !isReady()) return [];
  const db = await loadIndex(indexPath(context));
  if (!db) return [];
  const qvec = await embedQuery(q);
  if (!qvec) return [];

  const hits = await hybridSearch(db, { term: q, vector: qvec, limit: CAND });
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
