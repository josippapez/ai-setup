'use strict';

// These exercise the in-process embedder/reranker; the shared model server has its own tests.
process.env.MODEL_SERVER_DISABLE = '1';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { test } = require('node:test');

// Reproduces the post-reinstall npm race: the worker's require of
// @huggingface/transformers fails while deps are still installing, and the
// engine must retry after the cooldown once deps appear — not latch the
// process into a dead-embedder state for its whole lifetime.
test('embedder retries worker spawn after cooldown once deps appear', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semidx-retry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modDir = path.join(root, 'node_modules', '@huggingface', 'transformers');
  const driver = path.join(root, 'driver.cjs');
  fs.writeFileSync(driver, `
    'use strict';
    const fs = require('node:fs');
    const path = require('node:path');
    const engine = require(${JSON.stringify(path.join(__dirname, 'semantic-index.cjs'))});
    (async () => {
      const first = await engine.waitUntilReady(4000);
      const failed = engine.embedderStatus();
      // Deps "finish installing" only now: write a minimal transformers stub.
      fs.mkdirSync(${JSON.stringify(modDir)}, { recursive: true });
      fs.writeFileSync(path.join(${JSON.stringify(modDir)}, 'package.json'),
        JSON.stringify({ name: '@huggingface/transformers', version: '0.0.0', main: 'index.js' }));
      fs.writeFileSync(path.join(${JSON.stringify(modDir)}, 'index.js'), [
        "const f = async (t, o) => ({ data: new Array(384).fill(0) });",
        "f.tokenizer = { _tokenizerConfig: {} };",
        "exports.env = {};",
        // The GPU is unavailable here, so the engine must fall back to the CPU model.
        "exports.pipeline = async (task, id, opts) => { require('node:fs').appendFileSync(process.env.STUB_OPTS_FILE, JSON.stringify(opts) + '\\\\n'); if (opts.device === 'webgpu') throw new Error('no gpu'); return f; };",
      ].join('\\n'));
      await new Promise((r) => setTimeout(r, 100)); // past the test cooldown
      const second = await engine.waitUntilReady(8000);
      const vector = second ? await engine.embedQuery('hello') : null;
      console.log(JSON.stringify({
        first,
        failed,
        second,
        ready: engine.embedderStatus(),
        embedded: Array.isArray(vector) && vector.length === 384,
      }));
      await engine.shutdown();
      process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });
  `);

  const stdout = await new Promise((resolve, reject) => {
    execFile('node', [driver], {
      env: {
        ...process.env,
        NODE_PATH: path.join(root, 'node_modules'),
        REPO_DOCS_EMBED_RETRY_MS: '50',
        REPO_DOCS_MODELS_DIR: path.join(root, 'models'),
        STUB_OPTS_FILE: path.join(root, 'pipeline-opts.json'),
      },
      timeout: 30000,
    }, (err, out, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(out)));
  });

  const result = JSON.parse(stdout.trim().split('\n').pop());
  assert.strictEqual(result.first, false, 'must report not-ready while deps are missing');
  assert.strictEqual(result.failed.state, 'failed', 'a failed load must say so');
  assert.match(result.failed.error, /@huggingface\/transformers/, 'with the reason it failed');
  assert.ok(result.failed.retryInMs >= 0 && result.failed.retryInMs <= 50, 'and when the next load is allowed');
  assert.strictEqual(result.second, true, 'must recover after deps appear');
  assert.deepStrictEqual(result.ready, { state: 'ready' });
  assert.strictEqual(result.embedded, true, 'recovered worker must serve embeddings');
  const calls = fs.readFileSync(path.join(root, 'pipeline-opts.json'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepStrictEqual(calls.map(c => c.device || 'cpu'), ['webgpu', 'cpu'], 'the embedder must try the GPU first, then fall back to the CPU');
  assert.deepStrictEqual(calls[1].session_options, { intraOpNumThreads: 1, interOpNumThreads: 1 }, 'the CPU fallback must load with the thread cap');
});

// A per-chunk embed failure (e.g. an ONNX runtime error) must cost only that
// chunk, not the whole worker: the worker's message handler now catches it and
// replies null, so the NEXT embed on the same (still-alive) worker still works.
test('a chunk that throws resolves null while the worker stays alive for the next embed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semidx-crash-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modDir = path.join(root, 'node_modules', '@huggingface', 'transformers');
  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(path.join(modDir, 'package.json'),
    JSON.stringify({ name: '@huggingface/transformers', version: '0.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(modDir, 'index.js'), [
    "const f = async (t, o) => {",
    "  if (t === 'BOOM') throw new Error('simulated bad chunk');",
    "  return { data: new Array(384).fill(0) };",
    "};",
    "f.tokenizer = { _tokenizerConfig: {} };",
    "exports.env = {};",
    "exports.pipeline = async () => f;",
  ].join('\n'));

  const driver = path.join(root, 'driver.cjs');
  fs.writeFileSync(driver, `
    'use strict';
    const engine = require(${JSON.stringify(path.join(__dirname, 'semantic-index.cjs'))});
    (async () => {
      const ready = await engine.waitUntilReady(8000);
      const bad = await engine.embedDocument('BOOM');
      const good = await engine.embedDocument('fine');
      console.log(JSON.stringify({
        ready,
        bad,
        goodIsVector: Array.isArray(good) && good.length === 384,
      }));
      await engine.shutdown();
      process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });
  `);

  const stdout = await new Promise((resolve, reject) => {
    execFile('node', [driver], {
      env: {
        ...process.env,
        NODE_PATH: path.join(root, 'node_modules'),
        REPO_DOCS_MODELS_DIR: path.join(root, 'models'),
      },
      timeout: 30000,
    }, (err, out, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(out)));
  });

  const result = JSON.parse(stdout.trim().split('\n').pop());
  assert.strictEqual(result.ready, true);
  assert.strictEqual(result.bad, null, 'a throwing chunk must resolve null, not hang or crash the worker');
  assert.strictEqual(result.goodIsVector, true, 'the worker must still serve the next embed');
});

// Real model: token-dense text packs far more than 510 tokens into 1,500
// characters, so character-only windows would run past the context and lose
// their tails. embedDocChunks must cut those windows shorter and still cover
// every word, while prose that fits keeps exactly its character-only chunks.
test('embedDocChunks sizes chunks by the model tokenizer and keeps the whole doc', { skip: require('./test-runtime-deps.cjs').skipWithoutRuntimeDeps() }, async (t) => {
  const { chunkMarkdown } = require('./chunker.cjs');
  const engine = require('./semantic-index.cjs');
  t.after(() => engine.shutdown());
  assert.ok(await engine.waitUntilReady(), 'embedder must warm up');

  const words = Array.from({ length: 400 }, (_, i) => `x${i}q7z`);
  const dense = `# Dense\n${words.join(' ')}`;
  const chunks = await engine.embedDocChunks(dense, 'docs/dense.md');
  assert.ok(chunks.length > chunkMarkdown(dense).length, 'the token cap must cut windows shorter than characters alone would');
  assert.ok(chunks.every(c => c.vector.length === 384 && c.ctxVector.length === 384), 'each chunk gets a plain and a context vector');
  assert.notDeepStrictEqual(chunks[0].vector, chunks[0].ctxVector, 'the context vector embeds the doc path and breadcrumb too');
  const seen = new Set(chunks.flatMap(c => c.text.split(/\s+/)));
  assert.ok(words.every(w => seen.has(w)), 'every word is in some chunk');

  const prose = `# Prose\n${'The build pipeline publishes images nightly. '.repeat(60)}`;
  const proseChunks = await engine.embedDocChunks(prose, 'docs/prose.md');
  assert.deepStrictEqual(proseChunks.map(({ vector, ctxVector, ...rest }) => rest), chunkMarkdown(prose));
});

// A loaded embedder held 300 MB to 1.4 GB for the rest of a session. After
// REPO_DOCS_EMBED_IDLE_MS without a request its process must exit, and the next
// request must load it again.
test('the embedder process exits when idle and reloads on the next request', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semidx-idle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modDir = path.join(root, 'node_modules', '@huggingface', 'transformers');
  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(path.join(modDir, 'package.json'),
    JSON.stringify({ name: '@huggingface/transformers', version: '0.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(modDir, 'index.js'), [
    "const f = async () => ({ data: new Array(384).fill(0) });",
    "f.tokenizer = { _tokenizerConfig: {} };",
    "exports.env = {};",
    "exports.pipeline = async () => { require('node:fs').appendFileSync(process.env.STUB_PID_FILE, process.pid + '\\n'); return f; };",
  ].join('\n'));

  const driver = path.join(root, 'driver.cjs');
  fs.writeFileSync(driver, `
    'use strict';
    const fs = require('node:fs');
    const engine = require(${JSON.stringify(path.join(__dirname, 'semantic-index.cjs'))});
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const pids = () => fs.readFileSync(process.env.STUB_PID_FILE, 'utf8').trim().split('\\n').map(Number);
    (async () => {
      await engine.waitUntilReady(8000);
      const firstEmbed = Array.isArray(await engine.embedQuery('a'));
      const first = pids()[0];
      const aliveWhileUsed = alive(first);
      await new Promise((r) => setTimeout(r, 1200));
      const aliveAfterIdle = alive(first);
      const statusAfterIdle = engine.embedderStatus().state;
      const reloaded = await engine.waitUntilReady(8000);
      const secondEmbed = Array.isArray(await engine.embedQuery('b'));
      console.log(JSON.stringify({ firstEmbed, notInServer: first !== process.pid, aliveWhileUsed, aliveAfterIdle, statusAfterIdle, reloaded, secondEmbed, loads: pids().length }));
      await engine.shutdown();
      process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });
  `);

  const stdout = await new Promise((resolve, reject) => {
    execFile('node', [driver], {
      env: {
        ...process.env,
        NODE_PATH: path.join(root, 'node_modules'),
        REPO_DOCS_MODELS_DIR: path.join(root, 'models'),
        REPO_DOCS_EMBED_IDLE_MS: '300',
        STUB_PID_FILE: path.join(root, 'pids'),
      },
      timeout: 30000,
    }, (err, out, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(out)));
  });

  const r = JSON.parse(stdout.trim().split('\n').pop());
  assert.strictEqual(r.firstEmbed, true);
  assert.strictEqual(r.notInServer, true, 'the model must load in its own process, or exiting cannot free its memory');
  assert.strictEqual(r.aliveWhileUsed, true);
  assert.strictEqual(r.aliveAfterIdle, false, 'the embedder process must exit after the idle timeout');
  assert.notStrictEqual(r.statusAfterIdle, 'ready');
  assert.strictEqual(r.reloaded, true, 'the next request must load the model again');
  assert.strictEqual(r.secondEmbed, true);
  assert.strictEqual(r.loads, 2);
});
