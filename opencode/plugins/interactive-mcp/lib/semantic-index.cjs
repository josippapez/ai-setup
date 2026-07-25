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
    // Shared OpenCode model cache so each model is downloaded once.
    env.cacheDir = process.env.REPO_DOCS_MODELS_DIR
      || require('node:path').join(
        process.env.XDG_CONFIG_HOME || require('node:path').join(require('node:os').homedir(), '.config'),
        'opencode',
        'repo-docs-models',
      );
    const embed = await pipeline('feature-extraction', MODEL_ID, { dtype: MODEL_DTYPE });
    // Some model configs ship model_max_length as Infinity, so the pipeline's
    // hardcoded `truncation: true` never clips and docs over 512 tokens crash the
    // ONNX model (position-embedding broadcast mismatch). Pin the tokenizer's
    // ceiling to the model's real context so a rare token-dense chunk truncates
    // instead of crashing.
    embed.tokenizer._tokenizerConfig.model_max_length = MODEL_MAX_TOKENS;

    parentPort.on('message', async (msg) => {
      if (msg.type !== 'embed') return;
      const out = await embed(msg.text, { pooling: 'mean', normalize: true });
      parentPort.postMessage({
        type: 'embed',
        id: msg.id,
        vector: Array.from(out.data),
      });
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
let workerFailed = false;
let msgId = 0;
const pending = new Map();

function warmUp() {
  if (worker || workerFailed) return;

  try {
    worker = new Worker(__filename);
  } catch {
    workerFailed = true;
    return;
  }

  worker.on('message', (msg) => {
    if (msg.type === 'ready') {
      workerReady = true;
      return;
    }

    if (msg.type === 'embed') {
      const resolve = pending.get(msg.id);
      if (!resolve) return;
      pending.delete(msg.id);
      resolve(msg.vector);
      return;
    }

    if (msg.type === 'error') {
      workerFailed = true;
      workerReady = false;
      worker = null;
    }
  });

  worker.on('error', () => {
    workerFailed = true;
    workerReady = false;
    worker = null;
  });
}

function isReady() {
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
  if (workerFailed) return Promise.resolve(false);

  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (workerReady) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (workerFailed || Date.now() - start >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 250);
  });
}

function embedText(text) {
  if (!workerReady || !worker) return Promise.resolve(null);

  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    worker.postMessage({ type: 'embed', id, text });
  });
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
  MODEL_ID,
  MODEL_DTYPE,
  EMBED_DIM,
};
