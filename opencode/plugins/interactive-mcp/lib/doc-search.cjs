'use strict';

const { loadIndex, hybridSearch } = require('./doc-index.cjs');
const { isReady, embedQuery } = require('./semantic-index.cjs');
const { indexPath } = require('../tools/build-semantic-index.cjs');

const CAND = 60;

async function rankDocs(
  context,
  { query, limit = 12, threshold = 0, collapse = true } = {},
) {
  const value = String(query || '').trim();
  if (!value || !isReady()) return [];
  const index = await loadIndex(indexPath(context));
  if (!index) return [];
  const vector = await embedQuery(value);
  if (!vector) return [];

  const hits = await hybridSearch(index, {
    term: value,
    vector,
    limit: CAND,
  });
  if (!collapse) {
    return hits.filter((hit) => hit.score >= threshold).slice(0, limit);
  }
  const seen = new Set();
  const files = [];
  for (const hit of hits) {
    if (hit.score < threshold || seen.has(hit.path)) continue;
    seen.add(hit.path);
    files.push(hit);
    if (files.length >= limit) break;
  }
  return files;
}

module.exports = { rankDocs, CAND };
