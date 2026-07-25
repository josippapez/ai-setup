'use strict';

const RERANKER_ID = 'Xenova/bge-reranker-base';
let _mod = null, _failed = false;

function isRerankEnabled() { return process.env.RERANK_ENABLED === '1'; }

async function load() {
  if (_mod || _failed) return _mod;
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
    const model = await AutoModelForSequenceClassification.from_pretrained(RERANKER_ID, { dtype: 'q8' });
    _mod = { tokenizer, model };
  } catch { _failed = true; }
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
