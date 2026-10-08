'use strict';

const { Worker, isMainThread, parentPort } = require('node:worker_threads');

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
// 8-bit weights: 87 ms a chunk on one thread, against 108 ms for fp32 on two, with
// vectors at cosine 0.99+ of fp32's (measured on 64 README chunks).
const MODEL_DTYPE = 'q8';
// Half precision on the GPU: a 4,574-text NX build embedded in 79 s against 112 s
// for fp32, with vectors at cosine 0.9997+ of fp32's. Batches of 8 and 16 tied;
// 32 and 64 were slower.
const GPU_DTYPE = 'fp16';
const EMBED_BATCH = 16;
// bge-small's context ceiling. It ships model_max_length as Infinity, so the
// pipeline's hardcoded `truncation: true` never clips — see the worker below.
const MODEL_MAX_TOKENS = 512;
const EMBED_DIM = 384;
// bge-small wants the retrieval instruction on QUERIES only (not documents).
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
// onnxruntime spreads each run over every core by default: a doc-index build
// measured 278% CPU on an 8-core Mac, and two threads still held a core pair busy
// for a whole rebuild. One thread keeps a CPU-fallback build to one core.
const SESSION_OPTIONS = { intraOpNumThreads: 1, interOpNumThreads: 1 };

if (!isMainThread) {
  (async () => {
    const { createRequire } = require('node:module');
    const { pathToFileURL } = require('node:url');
    // NODE_PATH is honored by CJS require.resolve but NOT by ESM import(); resolve
    // the absolute entry via require, then import that file URL so the worker finds
    // @huggingface/transformers when it lives in CLAUDE_PLUGIN_DATA/node_modules.
    const entry = createRequire(__filename).resolve('@huggingface/transformers');
    const { pipeline, env } = await import(pathToFileURL(entry).href);
    // One model cache for every plugin data dir, so each model downloads once;
    // REPO_DOCS_MODELS_DIR overrides it.
    env.cacheDir = process.env.REPO_DOCS_MODELS_DIR
      || require('./platform.cjs').MODELS_DIR;
    // The GPU first: a full rebuild of 2,287 chunks measured 133 s and 36 s of CPU,
    // against 274 s and 274 s for the 8-bit model on one CPU thread, with the same
    // top hits. onnxruntime-node marks WebGPU experimental, so a load or first-run
    // failure falls back to the CPU model.
    let embed;
    try {
      embed = await pipeline('feature-extraction', MODEL_ID, { device: 'webgpu', dtype: GPU_DTYPE });
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
    // [SEP], so none is cut at the context limit and loses its tail. The budget
    // covers the context-prefixed text, the longer of the two a chunk is embedded as.
    const maxTokens = MODEL_MAX_TOKENS - 2;
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
        const splits = msg.docs.map(({ path: docPath, text }) => {
          const docName = String(docPath || '').replace(/\.mdx?$/, '');
          const context = (headingPath) => `${[docName, headingPath].filter(Boolean).join(' › ')}\n`;
          const countTokens = (t, headingPath) =>
            embed.tokenizer.encode(context(headingPath) + t, { add_special_tokens: false }).length;
          try {
            return chunkMarkdown(String(text || ''), { maxTokens, countTokens })
              .map(ch => ({ ch, texts: [ch.text, context(ch.headingPath) + ch.text] }));
          } catch {
            return null; // this doc alone fails
          }
        });
        let vectors;
        try {
          vectors = await vectorsOf(splits.flatMap(split => (split || []).flatMap(c => c.texts)));
        } catch {
          vectors = null;
        }
        let next = 0;
        const chunks = splits.map(split => split && vectors && split.map(({ ch }) => {
          const vector = vectors[next++], ctxVector = vectors[next++];
          return vector && ctxVector ? { ...ch, vector, ctxVector } : { ...ch, vector: null, ctxVector: null };
        }));
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
let lastError = '';
let startedAt = 0;
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

function markFailed(message) {
  // Node's module errors carry a multi-line require stack after the first line.
  lastError = String(message || 'unknown error').split('\n')[0];
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
    startedAt = Date.now();
  } catch (err) {
    markFailed(err.message);
    return;
  }

  worker.on('message', (msg) => {
    if (msg.type === 'ready') {
      lastFailedAt = 0;
      lastError = '';
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
      markFailed(msg.message);
    }
  });

  worker.on('error', (err) => {
    markFailed(err.message);
  });
}

function isReady() {
  // Query paths only probe readiness; give them the (cooldown-gated) retry
  // trigger too, so a post-failure process heals on the next query instead of
  // only when a build happens to run.
  if (!workerReady) warmUp();
  return workerReady;
}

// What a query that could not use the embedder tells the caller: why, and when to retry.
function embedderStatus() {
  if (workerReady) return { state: 'ready' };
  if (worker) return { state: 'loading', forMs: Date.now() - startedAt };
  return { state: 'failed', error: lastError || 'not started', retryInMs: Math.max(0, RETRY_COOLDOWN_MS - (Date.now() - lastFailedAt)) };
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
async function embedDocChunks(text, docPath) {
  const res = await embedDocsChunks([{ path: docPath, text }]);
  return res && res[0];
}

// embedDocChunks for several docs in one worker round, so their chunks share
// model batches. Resolves one entry per doc, in order (null for a doc that failed
// alone), or null when the embedder is unavailable.
function embedDocsChunks(docs) {
  return request('chunks', '', { docs: docs.map(d => ({ path: d.path, text: String(d.text || '') })) });
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
  embedderStatus,
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
