'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { test } = require('node:test');

// The server runs as a real process on a real socket; only the models are fake.
// Vectors are [text length, 1], scores are text lengths, and every load, batch and
// server pid is appended to FAKE_LOG.
const FAKE_LOADER = `
'use strict';
const fs = require('node:fs');
const log = (line) => fs.appendFileSync(process.env.FAKE_LOG, line + '\\n');
const delay = Number(process.env.FAKE_DELAY_MS) || 0;
log('pid ' + process.pid);
exports.loadEmbedder = async (model, load) => {
  log('load ' + model);
  return {
    async run(texts) {
      if (texts.some((t) => t.includes('BAD'))) throw new Error('bad text');
      await new Promise((r) => setTimeout(r, delay));
      log('batch ' + texts.join(','));
      return texts.map((t) => [t.length, 1]);
    },
  };
};
exports.loadReranker = async () => ({ score: async (q, texts) => texts.map((t) => t.length) });
`;

function harness(t, extraEnv = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mserver-')));
  const loader = path.join(root, 'loader.cjs');
  fs.writeFileSync(loader, FAKE_LOADER);
  const env = {
    MODEL_SERVER_DIR: path.join(root, 'sock'),
    MODEL_SERVER_LOADER: loader,
    FAKE_LOG: path.join(root, 'log.txt'),
    MODEL_CLIENT_RETRY_MS: '100',
    ...extraEnv,
  };
  fs.writeFileSync(env.FAKE_LOG, '');
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  const client = require('./model-client.cjs');
  const lines = () => fs.readFileSync(env.FAKE_LOG, 'utf8').split('\n').filter(Boolean);
  const serverPids = () => [...new Set(lines().filter((l) => l.startsWith('pid ')).map((l) => Number(l.slice(4))))];
  t.after(() => {
    client.close();
    for (const pid of serverPids()) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, env, client, lines, serverPids, sock: path.join(env.MODEL_SERVER_DIR, 'model-server.sock') };
}

const LOAD = { dtype: 'q8', cacheDir: '/unused' };
const embedOpts = (texts, priority = 'query') => ({ model: 'm', texts, load: LOAD, pooling: 'mean', normalize: true, priority });
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return false;
};

test('embed and rerank round-trip through a server the client starts', async (t) => {
  const h = harness(t);
  const res = await h.client.embed(embedOpts(['abc', 'de']));
  assert.deepStrictEqual(res, { vectors: [[3, 1], [2, 1]] });
  const ranked = await h.client.rerank({ model: 'r', query: 'q', texts: ['a', 'abc', 'ab'], load: LOAD });
  assert.deepStrictEqual(ranked, { order: [1, 2, 0] });
});

test('two clients starting at once end up with one server process', async (t) => {
  const h = harness(t);
  const driver = path.join(h.root, 'driver.cjs');
  fs.writeFileSync(driver, `
    require(${JSON.stringify(path.join(__dirname, 'model-client.cjs'))})
      .embed(${JSON.stringify(embedOpts(['xy']))})
      .then((r) => { console.log(JSON.stringify(r)); process.exit(0); });
  `);
  const run = () => new Promise((resolve, reject) => execFile('node', [driver], { env: { ...process.env }, timeout: 30000 },
    (err, out, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(JSON.parse(out.trim())))));
  const results = await Promise.all([run(), run(), run()]);
  for (const r of results) assert.deepStrictEqual(r, { vectors: [[2, 1]] });
  assert.strictEqual(h.serverPids().length, 1, 'one server process loaded the fake models');
  assert.strictEqual(h.lines().filter((l) => l.startsWith('load ')).length, 1, 'the model loaded once');
});

test('a query-priority request is served between the batches of a queued bulk one', async (t) => {
  const h = harness(t, { FAKE_DELAY_MS: '120' });
  await h.client.embed(embedOpts(['warm'])); // server up and model loaded, so timing below is batches only
  const bulkTexts = Array.from({ length: 64 }, (_, i) => `bulk-${String(i).padStart(2, '0')}`);
  const bulk = h.client.embed(embedOpts(bulkTexts, 'bulk'));
  await new Promise((r) => setTimeout(r, 180));
  const query = await h.client.embed(embedOpts(['the-query']));
  assert.deepStrictEqual(query, { vectors: [[9, 1]] });
  const batches = h.lines().filter((l) => l.startsWith('batch ')).slice(1);
  const at = batches.findIndex((l) => l === 'batch the-query');
  assert.ok(at >= 0 && at < 4, `the query ran after ${at} bulk batches of 4`);
  const done = await bulk;
  assert.strictEqual(done.vectors.length, 64);
  assert.ok(done.vectors.every((v) => v && v[0] === 7), 'the bulk request still completes');
});

test('a failing text comes back null and its neighbours do not', async (t) => {
  const h = harness(t);
  const res = await h.client.embed(embedOpts(['fine', 'BAD', 'good']));
  assert.deepStrictEqual(res.vectors, [[4, 1], null, [4, 1]]);
});

test('the server exits when idle and removes its socket', async (t) => {
  const h = harness(t, { MODEL_SERVER_IDLE_MS: '300' });
  await h.client.embed(embedOpts(['a']));
  assert.ok(fs.existsSync(h.sock), 'socket exists while the server is up');
  assert.ok(await until(() => !fs.existsSync(h.sock), 5000), 'socket removed after the idle exit');
  assert.ok(await until(() => { try { process.kill(h.serverPids()[0], 0); return false; } catch { return true; } }), 'process gone');
});

test('a socket file nobody answers on is replaced', async (t) => {
  const h = harness(t);
  fs.mkdirSync(h.env.MODEL_SERVER_DIR, { recursive: true });
  // A server that was killed leaves its socket file behind.
  const stale = spawn(process.execPath, ['-e', `require('node:net').createServer().listen(${JSON.stringify(h.sock)}, () => console.log('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((r) => stale.stdout.once('data', r));
  stale.kill('SIGKILL');
  await new Promise((r) => stale.once('exit', r));
  assert.ok(fs.existsSync(h.sock));
  const res = await h.client.embed(embedOpts(['abc']));
  assert.deepStrictEqual(res, { vectors: [[3, 1]] });
});

test('a lock left by a dead process does not block starting the server', async (t) => {
  const h = harness(t);
  fs.mkdirSync(h.env.MODEL_SERVER_DIR, { recursive: true });
  fs.writeFileSync(path.join(h.env.MODEL_SERVER_DIR, 'model-server.lock'), '999999');
  const res = await h.client.embed(embedOpts(['abc']));
  assert.deepStrictEqual(res, { vectors: [[3, 1]] });
});

test('a server speaking another protocol version is not used', async (t) => {
  const h = harness(t);
  fs.mkdirSync(h.env.MODEL_SERVER_DIR, { recursive: true });
  const old = net.createServer((c) => c.on('data', (d) => {
    const { id } = JSON.parse(d.toString().split('\n')[0]);
    c.write(JSON.stringify({ id, result: { version: 999 } }) + '\n');
  }));
  await new Promise((r) => old.listen(h.sock, r));
  t.after(() => old.close());
  assert.strictEqual(await h.client.embed(embedOpts(['abc'])), null);
});

test('an unreachable server gives null instead of an error', async (t) => {
  const h = harness(t, { MODEL_SERVER_DIR: '/dev/null/nope' });
  assert.strictEqual(await h.client.embed(embedOpts(['abc'])), null);
  assert.strictEqual(await h.client.rerank({ model: 'r', query: 'q', texts: ['a'], load: LOAD }), null);
});

// Stub @huggingface/transformers for the repo-docs callers that sit on top of the client.
function stubTransformers(root, opts = '') {
  const modDir = path.join(root, 'node_modules', '@huggingface', 'transformers');
  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(path.join(modDir, 'package.json'), JSON.stringify({ name: '@huggingface/transformers', version: '0.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(modDir, 'index.js'), `
    const fs = require('node:fs');
    const note = (s) => fs.appendFileSync(process.env.STUB_LOG, s + '\\n');
    exports.env = {};
    const f = async (t) => ({ dims: [Array.isArray(t) ? t.length : 1, 384], data: new Array(384 * (Array.isArray(t) ? t.length : 1)).fill(0.5) });
    f.tokenizer = { _tokenizerConfig: {}, encode: (t) => t.split(' ') };
    exports.pipeline = async () => { note('pipeline'); return f; };
    exports.AutoTokenizer = { from_pretrained: async () => { note('tokenizer'); return { _tokenizerConfig: {}, encode: (t) => t.split(' ') }; } };
    ${opts}
  `);
  return path.join(root, 'node_modules');
}

function runDriver(root, body, env) {
  const driver = path.join(root, `driver-${Math.random().toString(36).slice(2)}.cjs`);
  fs.writeFileSync(driver, `'use strict';\n(async () => {\n${body}\n})().catch((e) => { console.error(e); process.exit(1); });`);
  return new Promise((resolve, reject) => execFile('node', [driver], { env: { ...process.env, ...env }, timeout: 60000 },
    (err, out, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(JSON.parse(out.trim().split('\n').pop())))));
}

test('the embedder worker uses the server and loads only the tokenizer', async (t) => {
  const h = harness(t);
  const nodePath = stubTransformers(h.root);
  const stubLog = path.join(h.root, 'stub.txt');
  fs.writeFileSync(stubLog, '');
  const out = await runDriver(h.root, `
    const engine = require(${JSON.stringify(path.join(__dirname, 'semantic-index.cjs'))});
    const ready = await engine.waitUntilReady(10000);
    const query = await engine.embedQuery('hello');
    const chunks = await engine.embedDocChunks('# T\\n\\nsome text here', 'a.md');
    await engine.shutdown();
    console.log(JSON.stringify({ ready, query, chunk: chunks[0] && chunks[0].vector }));
    process.exit(0);
  `, { ...h.env, NODE_PATH: nodePath, STUB_LOG: stubLog, REPO_DOCS_MODELS_DIR: path.join(h.root, 'models') });
  assert.strictEqual(out.ready, true);
  // The fake server model makes [length, 1] vectors: the query carries the retrieval prefix.
  assert.strictEqual(out.query[0], 'Represent this sentence for searching relevant passages: hello'.length);
  assert.strictEqual(out.chunk[1], 1, 'chunk vectors came from the server');
  const stub = fs.readFileSync(stubLog, 'utf8').split('\n').filter(Boolean);
  assert.deepStrictEqual(stub, ['tokenizer'], 'the worker loaded the tokenizer and no ONNX pipeline');
});

test('the embedder worker falls back to loading the model itself when the server is unreachable', async (t) => {
  const h = harness(t, { MODEL_SERVER_DIR: '/dev/null/nope' });
  const nodePath = stubTransformers(h.root);
  const stubLog = path.join(h.root, 'stub.txt');
  fs.writeFileSync(stubLog, '');
  const out = await runDriver(h.root, `
    const engine = require(${JSON.stringify(path.join(__dirname, 'semantic-index.cjs'))});
    const ready = await engine.waitUntilReady(10000);
    const query = await engine.embedQuery('hello');
    await engine.shutdown();
    console.log(JSON.stringify({ ready, len: query && query.length }));
    process.exit(0);
  `, { ...h.env, NODE_PATH: nodePath, STUB_LOG: stubLog, REPO_DOCS_MODELS_DIR: path.join(h.root, 'models') });
  assert.deepStrictEqual(out, { ready: true, len: 384 });
  assert.ok(fs.readFileSync(stubLog, 'utf8').includes('pipeline'), 'the worker loaded the ONNX pipeline itself');
});

test('rerank goes through the server, and falls back to its own child when there is none', async (t) => {
  const h = harness(t);
  const nodePath = stubTransformers(h.root, `
    exports.AutoModelForSequenceClassification = { from_pretrained: async () => async (i) => ({ logits: { data: [i.__text === 'b' ? 1 : 0] } }) };
    exports.AutoTokenizer = { from_pretrained: async () => (q, o) => ({ __text: o.text_pair }) };
  `);
  const body = `
    const reranker = require(${JSON.stringify(path.join(__dirname, 'reranker.cjs'))});
    const order = await reranker.rerank('q', [{ text: 'a' }, { text: 'bb' }, { text: 'b' }]);
    console.log(JSON.stringify({ order }));
    process.exit(0);
  `;
  // Through the server the fake scorer ranks by text length; the child's stub ranks 'b' first.
  const viaServer = await runDriver(h.root, body, { ...h.env, NODE_PATH: nodePath });
  assert.deepStrictEqual(viaServer.order, [1, 0, 2]);
  const viaChild = await runDriver(h.root, body, { ...h.env, MODEL_SERVER_DIR: '/dev/null/nope', NODE_PATH: nodePath });
  assert.deepStrictEqual(viaChild.order, [2, 0, 1]);
});
