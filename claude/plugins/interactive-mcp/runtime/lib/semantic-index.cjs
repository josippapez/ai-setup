'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Worker, isMainThread, parentPort } = require('node:worker_threads');
const { relativePath } = require('./fs-utils.cjs');

const CACHE_FILE_NAME = 'interactive-mcp-doc-embeddings.json';
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MODEL_DTYPE = 'fp32';
const CACHE_SCHEMA_VERSION = 2;
const MAX_CHARS_PER_DOC = 2000;
const QUERY_MAX_CHARS = 500;
const SEMANTIC_THRESHOLD = 0.3;

if (!isMainThread) {
  (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    const embed = await pipeline('feature-extraction', MODEL_ID, { dtype: MODEL_DTYPE });

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
let buildingCache = false;
let msgId = 0;
const pending = new Map();

function cachePath(context) {
  return path.join(context.root, '.opencode', CACHE_FILE_NAME);
}

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

const CURRENT_META = { model: MODEL_ID, dtype: MODEL_DTYPE, schemaVersion: CACHE_SCHEMA_VERSION };

function metaMatches(meta) {
  return (
    meta &&
    meta.model === CURRENT_META.model &&
    meta.dtype === CURRENT_META.dtype &&
    meta.schemaVersion === CURRENT_META.schemaVersion
  );
}

function loadCache(context) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(context), 'utf8'));
    if (!metaMatches(raw._meta)) return {};
    return raw;
  } catch {
    return {};
  }
}

function saveCache(context, cache) {
  try {
    fs.mkdirSync(path.dirname(cachePath(context)), { recursive: true });
    fs.writeFileSync(cachePath(context), JSON.stringify({ ...cache, _meta: CURRENT_META }));
  } catch {}
}

function cosine(a, b) {
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) dot += a[index] * b[index];
  return dot;
}

async function indexFiles(context, docFiles, onlyMissing) {
  const cache = loadCache(context);
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const filePath of docFiles) {
    if (!workerReady) break;

    let stat;
    let content;
    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > context.maxFileSizeBytes) {
        skipped += 1;
        continue;
      }
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      skipped += 1;
      continue;
    }

    const key = relativePath(context.root, filePath);
    const cached = cache[key];
    if (onlyMissing && cached && cached.mtime === stat.mtimeMs) {
      unchanged += 1;
      continue;
    }

    const vector = await embedText(content.slice(0, MAX_CHARS_PER_DOC));
    if (!vector) {
      skipped += 1;
      continue;
    }

    cache[key] = { mtime: stat.mtimeMs, vector };
    updated += 1;
  }

  saveCache(context, cache);
  return { cachePath: cachePath(context), skipped, unchanged, updated };
}

async function buildCacheBackground(context, uncachedFiles) {
  if (buildingCache) return;
  buildingCache = true;
  try {
    await indexFiles(context, uncachedFiles, true);
  } finally {
    buildingCache = false;
  }
}

async function buildSemanticIndex(context, docFiles) {
  const ready = await waitUntilReady();
  if (!ready) return { cachePath: cachePath(context), skipped: docFiles.length, unchanged: 0, updated: 0 };
  return indexFiles(context, docFiles, true);
}

async function findSemantic(context, query, docFiles, limit) {
  if (!workerReady) return [];

  const queryVector = await embedText(query.slice(0, QUERY_MAX_CHARS));
  if (!queryVector) return [];

  const cache = loadCache(context);
  const results = [];
  const uncachedFiles = [];

  for (const filePath of docFiles) {
    let stat;
    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > context.maxFileSizeBytes) continue;
    } catch {
      continue;
    }

    const key = relativePath(context.root, filePath);
    const cached = cache[key];
    if (cached && cached.mtime === stat.mtimeMs) {
      const score = cosine(queryVector, cached.vector);
      if (score > SEMANTIC_THRESHOLD) results.push({ path: key, score });
      continue;
    }

    uncachedFiles.push(filePath);
  }

  if (uncachedFiles.length > 0) {
    setImmediate(() => buildCacheBackground(context, uncachedFiles).catch(() => {}));
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

module.exports = {
  buildSemanticIndex,
  findSemantic,
  isReady,
  shutdown,
  warmUp,
  waitUntilReady,
};
