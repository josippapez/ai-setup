#!/usr/bin/env node
'use strict';
// Ranking eval for find_docs. Calls the same rankDocs the tool calls, on this repo's own index.
//   node claude/plugins/repo-docs/evals/ranking/run.cjs [--json out.json]
//     [--root DIR --questions FILE --offtopic FILE]   another repo's index and labels (keep client labels out of this repo)
// Needs @huggingface/transformers and @orama/orama resolvable: set REPO_DOCS_NODE_MODULES, or it
// looks in the plugin data dirs under CLAUDE_CONFIG_DIR and ~/.claude.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PLUGIN = path.resolve(__dirname, '../..');
const flag = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const ROOT = path.resolve(flag('root') || path.resolve(PLUGIN, '../../..'));
const candidates = [
  process.env.REPO_DOCS_NODE_MODULES,
  ...[process.env.CLAUDE_CONFIG_DIR, path.join(os.homedir(), '.claude-work'), path.join(os.homedir(), '.claude')]
    .filter(Boolean).map(d => path.join(d, 'plugins/data/repo-docs-ai-setup/node_modules')),
].filter(Boolean);
const nodeModules = candidates.find(d => fs.existsSync(path.join(d, '@huggingface/transformers')) && fs.existsSync(path.join(d, '@orama/orama')));
if (!nodeModules) { console.error('no node_modules with @huggingface/transformers and @orama/orama; set REPO_DOCS_NODE_MODULES'); process.exit(1); }
// NODE_PATH is read at startup, so re-exec once with it set.
if (process.env.NODE_PATH !== nodeModules) {
  const r = require('node:child_process').spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, NODE_PATH: nodeModules, MODEL_SERVER_DISABLE: '1' },
  });
  process.exit(r.status ?? 1);
}

const { createContext } = require('../../runtime/lib/context.cjs');
const { rankDocs } = require('../../runtime/lib/doc-search.cjs');
const { waitUntilReady } = require('../../runtime/lib/semantic-index.cjs');
const { getCachedDb } = require('../../runtime/lib/doc-search.cjs');

const read = (name, f) => JSON.parse(fs.readFileSync(flag(name) || path.join(__dirname, f), 'utf8'));
const fmt = n => (n === null || n === undefined ? '   -   ' : n.toFixed(3).padStart(7));

async function pass(context, label, rerank) {
  const rows = [];
  for (const item of [...read('questions', 'questions.json').map(x => ({ ...x, on: true })), ...read('offtopic', 'offtopic.json').map(x => ({ ...x, on: false }))]) {
    const t = Date.now();
    const hits = await rankDocs(context, { query: item.q, limit: 12, threshold: 0, rerank, withSignals: true });
    if (!hits) throw new Error(`rankDocs unavailable for "${item.q}" (index not built or models missing)`);
    const rank = item.on ? hits.findIndex(h => item.expected.includes(h.path)) + 1 : 0;
    rows.push({ ...item, rank, returned: hits.length, ms: Date.now() - t, signals: hits.signals });
  }
  const on = rows.filter(r => r.on), off = rows.filter(r => !r.on);
  const at = k => on.filter(r => r.rank > 0 && r.rank <= k).length;
  const mrr = on.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / on.length;
  console.log(`\n== ${label} ==`);
  console.log(`on-topic n=${on.length}  hit@1 ${at(1)} (${(at(1) / on.length).toFixed(3)})  hit@3 ${at(3)} (${(at(3) / on.length).toFixed(3)})  MRR ${mrr.toFixed(3)}`);
  console.log(`off-topic n=${off.length}  return results: ${off.filter(r => r.returned > 0).length}`);
  console.log('signals per query (cosine = best dense cosine, hybrid = top Orama score, rerank = top cross-encoder logit)');
  for (const r of rows) console.log(`${r.on ? 'on ' : 'off'} ${r.id.padEnd(7)} rank ${String(r.rank || '-').padStart(2)}  cos ${fmt(r.signals.cosine)}  hyb ${fmt(r.signals.hybrid)}  rr ${fmt(r.signals.rerank)}  ${r.q.slice(0, 60)}`);
  for (const k of ['cosine', 'hybrid', 'rerank']) {
    const lo = Math.min(...on.map(r => r.signals[k] ?? Infinity)), hi = Math.max(...off.map(r => r.signals[k] ?? -Infinity));
    if (Number.isFinite(lo)) console.log(`${k}: lowest on-topic ${lo.toFixed(3)}, highest off-topic ${hi.toFixed(3)}, margin ${(lo - hi).toFixed(3)}`);
  }
  return { label, at1: at(1), at3: at(3), mrr, offReturned: off.filter(r => r.returned > 0).length, rows };
}

(async () => {
  const context = createContext(ROOT);
  if (!(await waitUntilReady(60000))) throw new Error('embedder did not load');
  const t = Date.now();
  await rankDocs(context, { query: 'warm up', rerank: false });
  console.log(`index load + first query ${Date.now() - t} ms`);
  const results = [await pass(context, 'rerank on', true), await pass(context, 'rerank off', false)];
  const out = process.argv.indexOf('--json');
  if (out > 0) fs.writeFileSync(process.argv[out + 1], JSON.stringify(results, null, 1));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
