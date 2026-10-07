'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { test } = require('node:test');

// Reproduces an offline/failed first rerank:true call: load() must retry after
// the cooldown instead of latching every later call into hybrid-only order for
// the rest of the process (the old `_failed` flag never reset).
test('reranker retries load after cooldown once a working stub appears', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reranker-retry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modDir = path.join(root, 'node_modules', '@huggingface', 'transformers');
  const driver = path.join(root, 'driver.cjs');
  fs.writeFileSync(driver, `
    'use strict';
    const reranker = require(${JSON.stringify(path.join(__dirname, 'reranker.cjs'))});
    (async () => {
      const candidates = [{ text: 'a' }, { text: 'b' }];
      // deps unresolvable yet -> load() fails -> identity order
      const first = await reranker.rerank('q', candidates);
      const fs = require('node:fs');
      const path = require('node:path');
      fs.mkdirSync(${JSON.stringify(modDir)}, { recursive: true });
      fs.writeFileSync(path.join(${JSON.stringify(modDir)}, 'package.json'),
        JSON.stringify({ name: '@huggingface/transformers', version: '0.0.0', main: 'index.js' }));
      fs.writeFileSync(path.join(${JSON.stringify(modDir)}, 'index.js'), [
        "exports.env = {};",
        // Deterministic stub: scores 'b' higher than 'a' so a real rerank is
        // distinguishable from the identity fallback.
        "exports.AutoTokenizer = { from_pretrained: async () => ((query, opts) => ({ __text: opts.text_pair })) };",
        "exports.AutoModelForSequenceClassification = { from_pretrained: async (id, opts) => { require('node:fs').writeFileSync(process.env.STUB_OPTS, JSON.stringify(opts.session_options)); return async (inputs) => ({ logits: { data: [inputs.__text === 'b' ? 1 : 0] } }); } };",
      ].join('\\n'));
      await new Promise((r) => setTimeout(r, 100)); // past the test cooldown
      const second = await reranker.rerank('q', candidates);
      console.log(JSON.stringify({ first, second, sessionOptions: JSON.parse(fs.readFileSync(process.env.STUB_OPTS, 'utf8')) }));
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
        STUB_OPTS: path.join(root, 'opts.json'),
      },
      timeout: 30000,
    }, (err, out, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(out)));
  });

  const result = JSON.parse(stdout.trim().split('\n').pop());
  assert.deepStrictEqual(result.first, [0, 1], 'must fall back to identity order while the model is unavailable');
  assert.deepStrictEqual(result.second, [1, 0], 'must recover and actually rerank once the stub becomes available');
  assert.deepStrictEqual(result.sessionOptions, { intraOpNumThreads: 4, interOpNumThreads: 1 }, 'the reranker must load with four threads');
});

test('the reranker process exits after the idle window, so its memory is freed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reranker-idle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modDir = path.join(root, 'node_modules', '@huggingface', 'transformers');
  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(path.join(modDir, 'package.json'), JSON.stringify({ name: '@huggingface/transformers', main: 'index.js' }));
  fs.writeFileSync(path.join(modDir, 'index.js'), [
    "exports.env = {};",
    "exports.AutoTokenizer = { from_pretrained: async () => ((q, o) => ({ __text: o.text_pair })) };",
    "exports.AutoModelForSequenceClassification = { from_pretrained: async () => async (i) => ({ logits: { data: [i.__text === 'b' ? 1 : 0] } }) };",
  ].join('\n'));
  const driver = path.join(root, 'driver.cjs');
  fs.writeFileSync(driver, `
    const reranker = require(${JSON.stringify(path.join(__dirname, 'reranker.cjs'))});
    const alive = () => require('node:child_process').execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' }).trim() !== '';
    const isAlive = () => { try { return alive(); } catch { return false; } };
    (async () => {
      const order = await reranker.rerank('q', [{ text: 'a' }, { text: 'b' }]);
      const during = isAlive();
      await new Promise((r) => setTimeout(r, 400));
      console.log(JSON.stringify({ order, during, after: isAlive() }));
      process.exit(0);
    })();
  `);
  const stdout = await new Promise((resolve, reject) => {
    execFile('node', [driver], { env: { ...process.env, NODE_PATH: path.join(root, 'node_modules'), REPO_DOCS_RERANK_IDLE_MS: '100' }, timeout: 30000 },
      (err, out, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(out)));
  });
  const result = JSON.parse(stdout.trim().split('\n').pop());
  assert.deepStrictEqual(result.order, [1, 0]);
  assert.strictEqual(result.during, true, 'the model process runs while queries come in');
  assert.strictEqual(result.after, false, 'it exits once idle');
});
