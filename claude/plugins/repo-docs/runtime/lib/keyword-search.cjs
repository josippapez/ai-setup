'use strict';

const fs = require('node:fs');
const { getDocFiles } = require('./docs.cjs');
const { relativePath } = require('./fs-utils.cjs');

// Keyword scorer for when semantic search is unavailable (model still loading,
// index not built yet, runtime deps missing), ported from the NX repo's
// repo-docs-libs server: path +4 per token, content matches capped at 3 per token,
// H1 title +3 per token, and a bonus for standards/guides docs when the query asks
// for conventions or guides.
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have',
  'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
  'from', 'as', 'into', 'through', 'during', 'before', 'after', 'between', 'out',
  'off', 'over', 'under', 'then', 'here', 'there', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'because', 'but', 'and', 'or', 'if', 'while', 'that', 'this', 'it', 'its',
]);

const DIR_TOKEN_MAP = [
  { dir: '/standards/', weight: 4, related: ['best', 'practices', 'practice', 'standard', 'standards', 'convention', 'rule', 'policy', 'guideline', 'guidelines'] },
  { dir: '/guides/', weight: 2, related: ['best', 'practices', 'practice', 'guide', 'guides', 'tutorial', 'setup', 'walkthrough'] },
];

function tokenize(input) {
  const raw = String(input || '').toLowerCase().split(/[^a-z0-9@._/-]+/g).filter(Boolean);
  const filtered = raw.filter(t => !STOP_WORDS.has(t));
  return filtered.length > 0 ? filtered : raw;
}

function countMatches(text, token, cap) {
  let idx = 0, count = 0;
  while (count < cap) {
    idx = text.indexOf(token, idx);
    if (idx === -1) break;
    count++;
    idx += token.length || 1;
  }
  return count;
}

// Best-first [{ path, score, lineNumber, snippet }], at most limit. lineNumber is
// the first line mentioning a query token (0 when none does).
function keywordSearch(context, query, limit) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const results = [];
  for (const filePath of getDocFiles(context)) {
    let stat, content;
    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > context.maxFileSizeBytes) continue;
      content = fs.readFileSync(filePath, 'utf8');
    } catch { continue; }
    const rel = relativePath(context.root, filePath);
    const lowerPath = rel.toLowerCase();
    const lowerContent = content.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (lowerPath.includes(token)) score += 4;
      score += countMatches(lowerContent, token, 3);
    }
    if (score <= 0) continue;
    const lines = content.split(/\r?\n/);
    const title = lines.find(l => /^#\s/.test(l));
    if (title) for (const token of tokens) if (title.toLowerCase().includes(token)) score += 3;
    for (const { dir, weight, related } of DIR_TOKEN_MAP) {
      if (!lowerPath.includes(dir)) continue;
      for (const token of tokens) if (related.includes(token)) score += weight;
      break;
    }
    const lineIdx = lines.findIndex(l => tokens.some(t => l.toLowerCase().includes(t)));
    results.push({ path: rel, score, lineNumber: lineIdx + 1, snippet: lineIdx >= 0 ? lines[lineIdx].trim() : '' });
  }
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return results.slice(0, limit);
}

module.exports = { keywordSearch };
