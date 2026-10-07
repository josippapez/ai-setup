'use strict';

// Four threads: the vote on 10 candidates measured 643 ms against 1,755 ms on one,
// with the same order on every query. It runs for a moment per query, unlike a
// build, so it does not get the embedder's CPU cap. The GPU (690 ms) reordered results.
const SESSION_OPTIONS = { intraOpNumThreads: 4, interOpNumThreads: 1 };

const RERANKER_ID = 'Xenova/bge-reranker-base';
let _mod = null, _lastFailedAt = 0;

// A failed load (e.g. offline on the first rerank:true call) retries after this
// cooldown instead of latching every later call into hybrid-only order for the
// rest of the process — same shape as semantic-index.cjs's embedder retry.
const RETRY_COOLDOWN_MS = Number(process.env.REPO_DOCS_EMBED_RETRY_MS) > 0
  ? Number(process.env.REPO_DOCS_EMBED_RETRY_MS)
  : 30000;

function isRerankEnabled() { return process.env.RERANK_ENABLED === '1'; }

function inFailureCooldown() { return _lastFailedAt !== 0 && Date.now() - _lastFailedAt < RETRY_COOLDOWN_MS; }

async function load() {
  if (_mod) return _mod;
  if (inFailureCooldown()) return null;
  try {
    const { createRequire } = require('node:module');
    const { pathToFileURL } = require('node:url');
    const entry = createRequire(__filename).resolve('@huggingface/transformers');
    const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import(pathToFileURL(entry).href);
    // Shared OpenCode model cache so the reranker downloads once.
    env.cacheDir = process.env.REPO_DOCS_MODELS_DIR
      || require('node:path').join(
        process.env.XDG_CONFIG_HOME || require('node:path').join(require('node:os').homedir(), '.config'),
        'opencode',
        'repo-docs-models',
      );
    const tokenizer = await AutoTokenizer.from_pretrained(RERANKER_ID);
    // q8: measured identical ranking to fp32 on 27/27 verbatim rerank queries
    // (both 100% hit@1 / 1.000 MRR) while ~4x smaller (~300MB vs 1.1GB).
    const model = await AutoModelForSequenceClassification.from_pretrained(RERANKER_ID, { dtype: 'q8', session_options: SESSION_OPTIONS });
    _mod = { tokenizer, model };
  } catch { _lastFailedAt = Date.now(); }
  return _mod;
}

// The model runs in a child process that exits after IDLE_MS without a query. Loaded in the
// server it held ~750 MB for the rest of the session after one find_docs, and dispose() did
// not give the memory back (RSS grew from +949 to +1,158 MB), so only an exit frees it.
const IDLE_MS = Number(process.env.REPO_DOCS_RERANK_IDLE_MS) > 0 ? Number(process.env.REPO_DOCS_RERANK_IDLE_MS) : 5 * 60 * 1000;

async function score(query, texts) {
  const m = await load();
  if (!m) return null;
  const scored = [];
  for (let i = 0; i < texts.length; i++) {
    const inputs = m.tokenizer(query, { text_pair: texts[i], padding: true, truncation: true });
    const { logits } = await m.model(inputs);
    scored.push({ i, s: logits.data[0] });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.map(x => x.i);
}

if (require.main === module) {
  process.on('message', ({ id, query, texts }) => {
    score(query, texts).catch(() => null).then(order => process.send({ id, order }));
  });
  process.on('disconnect', () => process.exit(0));
}

let child = null, idle = null, nextId = 0;
const pending = new Map();

function ensureChild() {
  if (child) return child;
  const { fork } = require('node:child_process');
  child = fork(__filename, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  child.on('message', ({ id, order }) => { pending.get(id)?.(order); pending.delete(id); });
  child.on('exit', () => {
    child = null;
    for (const done of pending.values()) done(null);
    pending.clear();
  });
  return child;
}

// Reorder candidates best-first. The CALLER decides whether to rerank (via a
// per-call flag or isRerankEnabled()); this function does not re-gate on the env
// so a per-call `rerank:true` works even when RERANK_ENABLED is unset.
async function rerank(query, candidates) {
  const identity = candidates.map((_, i) => i);
  if (candidates.length === 0) return identity;
  const proc = ensureChild();
  const id = ++nextId;
  const order = await new Promise(done => {
    pending.set(id, done);
    proc.send({ id, query, texts: candidates.map(c => String(c.text).slice(0, 2000)) });
  });
  clearTimeout(idle);
  idle = setTimeout(() => child?.kill(), IDLE_MS);
  idle.unref();
  return Array.isArray(order) && order.length === candidates.length ? order : identity;
}

module.exports = { isRerankEnabled, rerank, RERANKER_ID };
