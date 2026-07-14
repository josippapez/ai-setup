// Repeatable retrieval eval for the repo-docs hybrid search — drives the REAL
// shipped pipeline (chunker + bge-small embedder + Orama hybridSearch at the
// shipped hybridWeights), collapses chunk hits to files like find_docs, and
// reports hit@1 / hit@3 / MRR against a gold set of {query, path} pairs.
//
// Usage:
//   NODE_PATH="$HOME/.claude/plugins/data/interactive-mcp-ai-setup/node_modules" \
//   node docs/superpowers/evals/repo-docs-retrieval.mjs \
//     <repoRootToIndex> <gold.json> [pluginRuntimeDir]
//
// pluginRuntimeDir defaults to the interactive-mcp runtime in THIS repo.
// gold.json: [{ "query": "...", "path": "docs/..." }, ...] — path is repo-relative.
//
// RECORDED BASELINE (a real client docs repo, 82 docs / ~1007 chunks,
// 36 paraphrased NL queries, shipped hybridWeights text:0.2/vector:0.8):
//   ~81% hit@1, ~94% hit@3, ~0.88 MRR.
// Gate: no hit@1 regression vs this baseline on the same gold set.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [, , repoRoot, goldPath, runtimeArg] = process.argv;
if (!repoRoot || !goldPath) {
  console.error('usage: node repo-docs-retrieval.mjs <repoRoot> <gold.json> [pluginRuntimeDir]');
  process.exit(2);
}
const RT = runtimeArg || path.resolve(process.cwd(), 'claude/plugins/interactive-mcp/runtime');
const req = createRequire(import.meta.url);
const { chunkMarkdown } = req(path.join(RT, 'lib/chunker.cjs'));
const sem = req(path.join(RT, 'lib/semantic-index.cjs'));
const { createIndex, addChunks, hybridSearch } = req(path.join(RT, 'lib/doc-index.cjs'));

const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
const files = execFileSync('git', ['-C', repoRoot, 'ls-files', '*.md', '*.mdx'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  .split('\n').filter(Boolean).filter((f) => !/node_modules/.test(f)).filter((f) => /(^|\/)docs\//.test(f));
const docs = [];
for (const f of files) { try { const t = fs.readFileSync(`${repoRoot}/${f}`, 'utf8'); if (t.length <= 1_000_000) docs.push({ path: f, text: t }); } catch {} }
const known = new Set(docs.map((d) => d.path));
const cases = gold.filter((g) => known.has(g.path));

process.stderr.write(`indexing ${docs.length} docs; ${cases.length}/${gold.length} gold cases; warming embedder...\n`);
await sem.waitUntilReady();
const db = await createIndex();
let nChunks = 0;
for (const d of docs) {
  const records = [];
  for (const ch of chunkMarkdown(d.text)) {
    const embedding = await sem.embedDocument(ch.text);
    if (embedding) records.push({ path: d.path, heading: ch.headingPath, content: ch.text, startLine: ch.startLine, embedding });
  }
  if (records.length) { await addChunks(db, records); nChunks += records.length; }
}
process.stderr.write(`indexed ${nChunks} chunks\n`);

const ranks = [];
for (const g of cases) {
  const qv = await sem.embedQuery(g.query);
  const hits = await hybridSearch(db, { term: g.query, vector: qv, limit: 60 });
  const seen = new Set(); let rank = 0, found = 0;
  for (const h of hits) { if (seen.has(h.path)) continue; seen.add(h.path); rank++; if (h.path === g.path) { found = rank; break; } }
  ranks.push(found);
}
await sem.shutdown();

const n = ranks.length;
const hit1 = ranks.filter((r) => r === 1).length / n;
const hit3 = ranks.filter((r) => r >= 1 && r <= 3).length / n;
const mrr = ranks.reduce((s, r) => s + (r ? 1 / r : 0), 0) / n;
console.log(`repo_docs_eval docs=${docs.length} chunks=${nChunks} cases=${n} hit@1=${(hit1 * 100).toFixed(0)}% hit@3=${(hit3 * 100).toFixed(0)}% mrr=${mrr.toFixed(3)}`);
