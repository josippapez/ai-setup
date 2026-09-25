'use strict';

const RERANKER_ID = 'Xenova/bge-reranker-base';
let _mod = null, _lastFailedAt = 0;

// A failed load (e.g. offline on the first rerank:true call) retries after this
// cooldown instead of latching every later call into hybrid-only order for the
// rest of the process — same shape as semantic-index.cjs's embedder retry.
const RETRY_COOLDOWN_MS = Number(process.env.REPO_DOCS_EMBED_RETRY_MS) > 0
  ? Number(process.env.REPO_DOCS_EMBED_RETRY_MS)
  : 30000;

// On by default; RERANK_ENABLED=0 turns the cross-encoder vote off for every call.
function isRerankEnabled() { return process.env.RERANK_ENABLED !== '0'; }

function inFailureCooldown() { return _lastFailedAt !== 0 && Date.now() - _lastFailedAt < RETRY_COOLDOWN_MS; }

async function load() {
  if (_mod) return _mod;
  if (inFailureCooldown()) return null;
  try {
    const { createRequire } = require('node:module');
    const { pathToFileURL } = require('node:url');
    const entry = createRequire(__filename).resolve('@huggingface/transformers');
    const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import(pathToFileURL(entry).href);
    // Shared model cache across both plugins so each model is downloaded once,
    // not per plugin data dir. Defaults to ~/.claude/repo-docs-models; override
    // with the REPO_DOCS_MODELS_DIR env var.
    env.cacheDir = process.env.REPO_DOCS_MODELS_DIR
      || require('node:path').join(require('node:os').homedir(), '.claude', 'repo-docs-models');
    const tokenizer = await AutoTokenizer.from_pretrained(RERANKER_ID);
    // q8: measured identical ranking to fp32 on 27/27 verbatim rerank queries
    // (both 100% hit@1 / 1.000 MRR) while ~4x smaller (~300MB vs 1.1GB).
    const model = await AutoModelForSequenceClassification.from_pretrained(RERANKER_ID, { dtype: 'q8' });
    _mod = { tokenizer, model };
  } catch { _lastFailedAt = Date.now(); }
  return _mod;
}

// Reorder candidates best-first. The CALLER decides whether to rerank (via a
// per-call flag or isRerankEnabled()); this function does not re-gate on the env
// so a per-call `rerank:true` works even when RERANK_ENABLED is unset.
async function rerank(query, candidates) {
  const identity = candidates.map((_, i) => i);
  if (candidates.length === 0) return identity;
  const m = await load();
  if (!m) return identity;
  try {
    const scored = [];
    for (let i = 0; i < candidates.length; i++) {
      const inputs = m.tokenizer(query, { text_pair: String(candidates[i].text).slice(0, 2000), padding: true, truncation: true });
      const { logits } = await m.model(inputs);
      scored.push({ i, s: logits.data[0] });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.map(x => x.i);
  } catch { return identity; }
}

module.exports = { isRerankEnabled, rerank, RERANKER_ID };
