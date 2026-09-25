'use strict';

const { Worker, isMainThread, parentPort } = require('node:worker_threads');

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const MODEL_DTYPE = 'fp32';
// bge-small's context ceiling. It ships model_max_length as Infinity, so the
// pipeline's hardcoded `truncation: true` never clips — see the worker below.
const MODEL_MAX_TOKENS = 512;
const EMBED_DIM = 384;
// bge-small wants the retrieval instruction on QUERIES only (not documents).
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

if (!isMainThread) {
  (async () => {
    const { createRequire } = require('node:module');
    const { pathToFileURL } = require('node:url');
    // NODE_PATH is honored by CJS require.resolve but NOT by ESM import(); resolve
    // the absolute entry via require, then import that file URL so the worker finds
    // @huggingface/transformers when it lives in CLAUDE_PLUGIN_DATA/node_modules.
    const entry = createRequire(__filename).resolve('@huggingface/transformers');
    const { pipeline, env } = await import(pathToFileURL(entry).href);
    // Shared model cache across both plugins so each model is downloaded once,
    // not per plugin data dir. Defaults to ~/.claude/repo-docs-models; override
    // with the REPO_DOCS_MODELS_DIR env var.
    env.cacheDir = process.env.REPO_DOCS_MODELS_DIR
      || require('node:path').join(require('node:os').homedir(), '.claude', 'repo-docs-models');
    const embed = await pipeline('feature-extraction', MODEL_ID, { dtype: MODEL_DTYPE });
    // Some model configs ship model_max_length as Infinity, so the pipeline's
    // hardcoded `truncation: true` never clips and docs over 512 tokens crash the
    // ONNX model (position-embedding broadcast mismatch). Pin the tokenizer's
    // ceiling to the model's real context so a rare token-dense chunk truncates
    // instead of crashing.
    embed.tokenizer._tokenizerConfig.model_max_length = MODEL_MAX_TOKENS;

    const { chunkMarkdown } = require('./chunker.cjs');
    // Chunks are sized with the model's own tokenizer, leaving room for [CLS] and
    // [SEP], so none is cut at the context limit and loses its tail. The budget
    // covers the context-prefixed text, the longer of the two a chunk is embedded as.
    const maxTokens = MODEL_MAX_TOKENS - 2;
    const vectorOf = async (text) => Array.from((await embed(text, { pooling: 'mean', normalize: true })).data);

    parentPort.on('message', async (msg) => {
      if (msg.type === 'chunks') {
        const docName = String(msg.path || '').replace(/\.mdx?$/, '');
        const context = (headingPath) => `${[docName, headingPath].filter(Boolean).join(' › ')}\n`;
        const countTokens = (text, headingPath) =>
          embed.tokenizer.encode(context(headingPath) + text, { add_special_tokens: false }).length;
        let chunks;
        try {
          chunks = [];
          for (const ch of chunkMarkdown(msg.text, { maxTokens, countTokens })) {
            let vector = null, ctxVector = null;
            try {
              vector = await vectorOf(ch.text);
              ctxVector = await vectorOf(context(ch.headingPath) + ch.text);
            } catch { /* this chunk alone is skipped, as in the embed branch below */ }
            chunks.push(vector && ctxVector ? { ...ch, vector, ctxVector } : { ...ch, vector: null, ctxVector: null });
          }
        } catch {
          chunks = null;
        }
        parentPort.postMessage({ type: 'chunks', id: msg.id, chunks });
        return;
      }
      if (msg.type !== 'embed') return;
      try {
        const out = await embed(msg.text, { pooling: 'mean', normalize: true });
        parentPort.postMessage({
          type: 'embed',
          id: msg.id,
          vector: Array.from(out.data),
        });
      } catch {
        // One bad chunk (e.g. an ONNX runtime error) must cost one chunk, not
        // the whole worker: reply null instead of letting the throw kill it.
        parentPort.postMessage({ type: 'embed', id: msg.id, vector: null });
      }
    });

    parentPort.postMessage({ type: 'ready' });
  })().catch((err) => {
    parentPort.postMessage({ type: 'error', message: err.message });
    process.exit(1);
  });
  return;
}

let worker = null;
let workerReady = false;
let lastFailedAt = 0;
let msgId = 0;
const pending = new Map();

// A failed spawn (e.g. runtime deps still npm-installing right after a plugin
// reinstall) retries after this cooldown instead of latching the process into
// a dead-embedder state for its whole lifetime.
const RETRY_COOLDOWN_MS = Number(process.env.REPO_DOCS_EMBED_RETRY_MS) > 0
  ? Number(process.env.REPO_DOCS_EMBED_RETRY_MS)
  : 30000;

function inFailureCooldown() {
  return lastFailedAt !== 0 && Date.now() - lastFailedAt < RETRY_COOLDOWN_MS;
}

function markFailed() {
  lastFailedAt = Date.now();
  workerReady = false;
  worker = null;
  // Resolve anything awaiting an embed so builds/queries fail fast with null
  // instead of hanging on a worker that will never answer.
  for (const resolve of pending.values()) resolve(null);
  pending.clear();
}

function warmUp() {
  if (worker || inFailureCooldown()) return;

  try {
    worker = new Worker(__filename);
  } catch {
    markFailed();
    return;
  }

  worker.on('message', (msg) => {
    if (msg.type === 'ready') {
      lastFailedAt = 0;
      workerReady = true;
      return;
    }

    if (msg.type === 'embed' || msg.type === 'chunks') {
      const resolve = pending.get(msg.id);
      if (!resolve) return;
      pending.delete(msg.id);
      resolve(msg.type === 'chunks' ? msg.chunks : msg.vector);
      return;
    }

    if (msg.type === 'error') {
      markFailed();
    }
  });

  worker.on('error', () => {
    markFailed();
  });
}

function isReady() {
  // Query paths only probe readiness; give them the (cooldown-gated) retry
  // trigger too, so a post-failure process heals on the next query instead of
  // only when a build happens to run.
  if (!workerReady) warmUp();
  return workerReady;
}

async function shutdown() {
  if (!worker) return;
  const activeWorker = worker;
  worker = null;
  workerReady = false;
  pending.clear();
  await activeWorker.terminate().catch(() => {});
}

function waitUntilReady(timeoutMs = 300000) {
  warmUp();
  if (workerReady) return Promise.resolve(true);
  if (inFailureCooldown()) return Promise.resolve(false);

  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (workerReady) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (inFailureCooldown() || Date.now() - start >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 250);
  });
}

function request(type, text, extra = {}) {
  if (!workerReady || !worker) return Promise.resolve(null);

  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    worker.postMessage({ ...extra, type, id, text });
  });
}

function embedText(text) {
  return request('embed', text);
}

// Chunks a whole doc and embeds every chunk twice: its text alone (vector) and
// with the doc path and heading breadcrumb in front (ctxVector). Resolves
// [{ headingPath, startLine, text, vector, ctxVector }] (both null for a chunk that
// failed on its own), or null when the embedder is unavailable.
function embedDocChunks(text, docPath) {
  return request('chunks', String(text || ''), { path: docPath });
}

async function embedQuery(text) {
  return embedText(QUERY_PREFIX + String(text || ''));
}

async function embedDocument(text) {
  return embedText(String(text || ''));
}

module.exports = {
  warmUp,
  waitUntilReady,
  isReady,
  shutdown,
  embedQuery,
  embedDocument,
  embedDocChunks,
  MODEL_ID,
  MODEL_DTYPE,
  EMBED_DIM,
};
