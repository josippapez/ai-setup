'use strict';

const { Worker, isMainThread, parentPort } = require('node:worker_threads');

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const MODEL_DTYPE = 'fp32';
// Batches of 16 on the GPU measured 42 ms a chunk, one at a time 58.
const EMBED_BATCH = 16;
// bge-small's context ceiling. It ships model_max_length as Infinity, so the
// pipeline's hardcoded `truncation: true` never clips — see the worker below.
const MODEL_MAX_TOKENS = 512;
const EMBED_DIM = 384;
// bge-small wants the retrieval instruction on QUERIES only (not documents).
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
// onnxruntime spreads each run over every core by default: a doc-index build
// measured 278% CPU on an 8-core Mac. Two threads measured 191% with a third less
// total CPU work and no slower build. The reranker uses the same cap.
const SESSION_OPTIONS = { intraOpNumThreads: 2, interOpNumThreads: 1 };

if (!isMainThread) {
  (async () => {
    const { createRequire } = require('node:module');
    const { pathToFileURL } = require('node:url');
    // NODE_PATH is honored by CJS require.resolve but NOT by ESM import(); resolve
    // the absolute entry via require, then import that file URL so the worker finds
    // @huggingface/transformers when it lives in CLAUDE_PLUGIN_DATA/node_modules.
    const entry = createRequire(__filename).resolve('@huggingface/transformers');
    const { pipeline, env } = await import(pathToFileURL(entry).href);
    // Shared OpenCode model cache so each model is downloaded once.
    env.cacheDir = process.env.REPO_DOCS_MODELS_DIR
      || require('node:path').join(
        process.env.XDG_CONFIG_HOME || require('node:path').join(require('node:os').homedir(), '.config'),
        'opencode',
        'repo-docs-models',
      );
    // The GPU first: a full rebuild of 2,287 chunks measured 133 s and 36 s of CPU,
    // against 274 s and 274 s for the 8-bit model on one CPU thread, with the same
    // top hits. onnxruntime-node marks WebGPU experimental, so a load or first-run
    // failure falls back to the CPU model.
    let embed;
    try {
      embed = await pipeline('feature-extraction', MODEL_ID, { device: 'webgpu', dtype: MODEL_DTYPE });
      await embed('warm up', { pooling: 'mean', normalize: true });
    } catch {
      embed = await pipeline('feature-extraction', MODEL_ID, { dtype: MODEL_DTYPE, session_options: SESSION_OPTIONS });
    }
    // Some model configs ship model_max_length as Infinity, so the pipeline's
    // hardcoded `truncation: true` never clips and docs over 512 tokens crash the
    // ONNX model (position-embedding broadcast mismatch). Pin the tokenizer's
    // ceiling to the model's real context so a rare token-dense chunk truncates
    // instead of crashing.
    embed.tokenizer._tokenizerConfig.model_max_length = MODEL_MAX_TOKENS;

    const { chunkMarkdown } = require('./chunker.cjs');
    // Chunks are sized with the model's own tokenizer, leaving room for [CLS] and
    // [SEP], so none is cut at the context limit and loses its tail.
    const maxTokens = MODEL_MAX_TOKENS - 2;
    const countTokens = (text) => embed.tokenizer.encode(text, { add_special_tokens: false }).length;
    const vectorOf = async (text) => Array.from((await embed(text, { pooling: 'mean', normalize: true })).data);
    // Vectors for texts in order, EMBED_BATCH per model run. A batch that throws is
    // retried one text at a time, so a bad text costs only itself (null).
    // Batches are cut from the texts sorted by length, so each pads to a near neighbour.
    const vectorsOf = async (texts) => {
      const out = new Array(texts.length).fill(null);
      const order = texts.map((_, i) => i).sort((a, b) => texts[a].length - texts[b].length);
      for (let i = 0; i < order.length; i += EMBED_BATCH) {
        const idx = order.slice(i, i + EMBED_BATCH);
        try {
          const res = await embed(idx.map(j => texts[j]), { pooling: 'mean', normalize: true });
          const dim = res.dims[res.dims.length - 1];
          idx.forEach((j, k) => { out[j] = Array.from(res.data.slice(k * dim, (k + 1) * dim)); });
        } catch {
          for (const j of idx) out[j] = await vectorOf(texts[j]).catch(() => null);
        }
      }
      return out;
    };

    parentPort.on('message', async (msg) => {
      if (msg.type === 'chunks') {
        // Every doc in the message is chunked first and all their texts are embedded
        // together, so batches stay full across docs too small to fill one alone.
        const splits = msg.docs.map((text) => {
          try { return chunkMarkdown(text, { maxTokens, countTokens }); }
          catch { return null; } // this doc alone fails
        });
        let vectors;
        try {
          vectors = await vectorsOf(splits.flatMap(split => (split || []).map(ch => ch.text)));
        } catch {
          vectors = null;
        }
        let next = 0;
        const chunks = splits.map(split => split && vectors && split.map(ch => ({ ...ch, vector: vectors[next++] })));
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

// Chunks a whole doc and embeds every chunk. Resolves
// [{ headingPath, startLine, text, vector }] (vector null for a chunk that failed
// on its own), or null when the embedder is unavailable.
async function embedDocChunks(text) {
  const res = await embedDocsChunks([text]);
  return res && res[0];
}

// embedDocChunks for several docs in one worker round, so their chunks share
// model batches. Resolves one entry per doc, in order (null for a doc that failed
// alone), or null when the embedder is unavailable.
function embedDocsChunks(texts) {
  return request('chunks', '', { docs: texts.map(t => String(t || '')) });
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
  embedDocsChunks,
  MODEL_ID,
  MODEL_DTYPE,
  EMBED_DIM,
  SESSION_OPTIONS,
};
