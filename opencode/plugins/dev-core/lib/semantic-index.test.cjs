'use strict';

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
      // Deps "finish installing" only now: write a minimal transformers stub.
      fs.mkdirSync(${JSON.stringify(modDir)}, { recursive: true });
      fs.writeFileSync(path.join(${JSON.stringify(modDir)}, 'package.json'),
        JSON.stringify({ name: '@huggingface/transformers', version: '0.0.0', main: 'index.js' }));
      fs.writeFileSync(path.join(${JSON.stringify(modDir)}, 'index.js'), [
        "const f = async (t, o) => ({ data: new Array(384).fill(0) });",
        "f.tokenizer = { _tokenizerConfig: {} };",
        "exports.env = {};",
        "exports.pipeline = async () => f;",
      ].join('\\n'));
      await new Promise((r) => setTimeout(r, 100)); // past the test cooldown
      const second = await engine.waitUntilReady(8000);
      const vector = second ? await engine.embedQuery('hello') : null;
      console.log(JSON.stringify({
        first,
        second,
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
      },
      timeout: 30000,
    }, (err, out, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(out)));
  });

  const result = JSON.parse(stdout.trim().split('\n').pop());
  assert.strictEqual(result.first, false, 'must report not-ready while deps are missing');
  assert.strictEqual(result.second, true, 'must recover after deps appear');
  assert.strictEqual(result.embedded, true, 'recovered worker must serve embeddings');
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
