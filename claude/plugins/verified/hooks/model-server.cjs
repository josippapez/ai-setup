#!/usr/bin/env node
'use strict';

// One process per machine that holds the ONNX models, so N Claude Code sessions share
// one embedder and one reranker instead of N copies (a reranker child alone measured
// 1,230 MB, an embedder child 125 MB). Generic ops only: it needs node built-ins and
// @huggingface/transformers, so other plugins can run this same file.
//
// Protocol: newline-delimited JSON over a unix socket. A request is { id, op, ...body },
// the reply { id, result } or { id, error }. Ops: hello, embed, rerank (see model-client.cjs).

const fs = require('node:fs');
const net = require('node:net');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const PROTOCOL = 1;
const EMBED_BATCH = 16;
// Only an exit frees onnxruntime's memory (dispose() did not give it back), so the
// server exits when nobody has asked for anything for this long.
const IDLE_MS = Number(process.env.MODEL_SERVER_IDLE_MS) > 0
  ? Number(process.env.MODEL_SERVER_IDLE_MS)
  : 10 * 60 * 1000;

let transformersModule = null;
async function transformers() {
  if (!transformersModule) {
    // NODE_PATH is honored by CJS require.resolve but NOT by ESM import().
    const entry = createRequire(__filename).resolve('@huggingface/transformers');
    transformersModule = await import(pathToFileURL(entry).href);
  }
  return transformersModule;
}

async function loadEmbedder(model, load) {
  const { pipeline } = await transformers();
  let pipe = null;
  // onnxruntime-node marks WebGPU experimental, so a load or first-run failure falls
  // back to the CPU model.
  if (load.device === 'webgpu') {
    try {
      pipe = await pipeline('feature-extraction', model, { device: 'webgpu', dtype: load.dtype });
      await pipe('warm up', { pooling: 'mean', normalize: true });
    } catch {
      pipe = null;
    }
  }
  if (!pipe) {
    pipe = await pipeline('feature-extraction', model, {
      dtype: load.device === 'webgpu' ? (load.fallbackDtype || load.dtype) : load.dtype,
      ...(load.sessionOptions ? { session_options: load.sessionOptions } : {}),
    });
  }
  // Some model configs ship model_max_length as Infinity, so the pipeline's hardcoded
  // `truncation: true` never clips and over-long texts crash the ONNX model.
  if (load.maxTokens) pipe.tokenizer._tokenizerConfig.model_max_length = load.maxTokens;
  return {
    async run(texts, { pooling, normalize }) {
      const res = await pipe(texts, { pooling, normalize });
      const dim = res.dims[res.dims.length - 1];
      return texts.map((_, k) => Array.from(res.data.slice(k * dim, (k + 1) * dim)));
    },
  };
}

async function loadReranker(model, load) {
  const { AutoTokenizer, AutoModelForSequenceClassification } = await transformers();
  const tokenizer = await AutoTokenizer.from_pretrained(model);
  const net_ = await AutoModelForSequenceClassification.from_pretrained(model, {
    dtype: load.dtype,
    ...(load.sessionOptions ? { session_options: load.sessionOptions } : {}),
  });
  return {
    async score(query, texts) {
      const scores = [];
      for (const text of texts) {
        const inputs = tokenizer(query, { text_pair: text, padding: true, truncation: true });
        const { logits } = await net_(inputs);
        scores.push(logits.data[0]);
      }
      return scores;
    },
  };
}

// Tests swap the loaders for fake models: MODEL_SERVER_LOADER names a module
// exporting loadEmbedder(model, load) -> { run(texts, {pooling, normalize}) -> number[][] }
// and loadReranker(model, load) -> { score(query, texts) -> number[] }.
const getLoaders = () => (process.env.MODEL_SERVER_LOADER
  ? require(process.env.MODEL_SERVER_LOADER)
  : { loadEmbedder, loadReranker });

const models = new Map();
// Loads run one at a time, each with the cacheDir its request asked for.
let loadChain = Promise.resolve();
let activeJobs = 0;
let idleTimer = null;

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => (activeJobs ? armIdle() : process.exit(0)), IDLE_MS);
}

function entryFor(kind, model, load) {
  const key = JSON.stringify([kind, model, load]);
  let entry = models.get(key);
  if (!entry) {
    entry = { kind, model, load, impl: null, loading: null, queue: [], running: false };
    models.set(key, entry);
  }
  return entry;
}

function ensureLoaded(entry) {
  if (entry.impl) return Promise.resolve(entry.impl);
  if (!entry.loading) {
    const run = async () => {
      if (!process.env.MODEL_SERVER_LOADER && entry.load.cacheDir) (await transformers()).env.cacheDir = entry.load.cacheDir;
      const loaders = getLoaders();
      return entry.kind === 'embed'
        ? loaders.loadEmbedder(entry.model, entry.load)
        : loaders.loadReranker(entry.model, entry.load);
    };
    entry.loading = loadChain.then(run);
    loadChain = entry.loading.catch(() => {});
    entry.loading.then((impl) => { entry.impl = impl; }, () => { entry.loading = null; });
  }
  return entry.loading;
}

// One inference at a time per model. A query-priority unit jumps ahead of every queued
// bulk unit, so an index build (thousands of texts) cannot make find_docs wait for it.
async function pump(entry) {
  if (entry.running) return;
  entry.running = true;
  try {
    while (entry.queue.length) {
      const at = entry.queue.findIndex((u) => u.priority === 'query');
      const unit = entry.queue.splice(at < 0 ? 0 : at, 1)[0];
      if (unit.job.finished || unit.job.conn.destroyed) { unit.job.finish(new Error('cancelled')); continue; }
      try {
        unit.run(await ensureLoaded(entry));
        await unit.pending;
      } catch (err) {
        unit.job.finish(err);
      }
    }
  } finally {
    entry.running = false;
  }
}

function makeJob(conn, id, units) {
  const job = {
    conn, finished: false, remaining: units, result: null,
    finish(err) {
      if (job.finished) return;
      if (err === null && job.remaining > 0) return;
      job.finished = true;
      activeJobs--;
      armIdle();
      if (conn.destroyed) return;
      conn.write(JSON.stringify(err ? { id, error: String(err.message || err) } : { id, result: job.result }) + '\n');
    },
  };
  activeJobs++;
  return job;
}

function handleEmbed(conn, msg) {
  const { model, texts, load = {}, pooling = 'mean', normalize = true, priority = 'bulk' } = msg;
  const out = new Array(texts.length).fill(null);
  // Batches are cut from the texts sorted by length, so each pads to a near neighbour.
  const order = texts.map((_, i) => i).sort((a, b) => texts[a].length - texts[b].length);
  const batches = [];
  for (let i = 0; i < order.length; i += EMBED_BATCH) batches.push(order.slice(i, i + EMBED_BATCH));
  const job = makeJob(conn, msg.id, batches.length);
  job.result = { vectors: out };
  if (!batches.length) { job.finish(null); return; }
  const entry = entryFor('embed', model, load);
  for (const idx of batches) {
    const unit = {
      priority, job,
      run(impl) {
        unit.pending = (async () => {
          try {
            const vectors = await impl.run(idx.map((j) => texts[j]), { pooling, normalize });
            idx.forEach((j, k) => { out[j] = vectors[k]; });
          } catch {
            // A batch that throws is retried one text at a time, so a bad text costs only itself.
            for (const j of idx) {
              out[j] = await impl.run([texts[j]], { pooling, normalize }).then((v) => v[0], () => null);
            }
          }
          job.remaining--;
          job.finish(null);
        })();
      },
    };
    entry.queue.push(unit);
  }
  pump(entry);
}

function handleRerank(conn, msg) {
  const { model, query, texts, load = {}, priority = 'query' } = msg;
  const job = makeJob(conn, msg.id, 1);
  const entry = entryFor('rerank', model, load);
  const unit = {
    priority, job,
    run(impl) {
      unit.pending = impl.score(query, texts).then((scores) => {
        job.result = { order: scores.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).map((x) => x.i) };
        job.remaining--;
        job.finish(null);
      });
    },
  };
  entry.queue.push(unit);
  pump(entry);
}

function handle(conn, line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  armIdle();
  try {
    if (msg.op === 'hello') conn.write(JSON.stringify({ id: msg.id, result: { version: PROTOCOL, pid: process.pid } }) + '\n');
    else if (msg.op === 'embed') handleEmbed(conn, msg);
    else if (msg.op === 'rerank') handleRerank(conn, msg);
    else conn.write(JSON.stringify({ id: msg.id, error: `unknown op ${msg.op}` }) + '\n');
  } catch (err) {
    conn.write(JSON.stringify({ id: msg.id, error: String(err.message || err) }) + '\n');
  }
}

function answers(socketPath) {
  return new Promise((resolve) => {
    const probe = net.connect(socketPath);
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', () => resolve(false));
  });
}

async function start(socketPath) {
  if (fs.existsSync(socketPath)) {
    if (await answers(socketPath)) process.exit(0); // another server is already up
    fs.rmSync(socketPath, { force: true });
  }
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line) handle(conn, line);
      }
    });
    conn.on('error', () => {});
  });
  server.on('error', () => process.exit(1));
  process.on('exit', () => { try { fs.rmSync(socketPath, { force: true }); } catch {} });
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => process.exit(0));
  server.listen(socketPath, armIdle);
}

if (require.main === module) {
  if (!process.argv[2]) process.exit(2);
  start(process.argv[2]);
}

module.exports = { PROTOCOL };
