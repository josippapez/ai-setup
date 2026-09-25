'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { createContext } = require('../lib/context.cjs');
const { shutdown } = require('../lib/semantic-index.cjs');
const { buildDocIndex } = require('./build-semantic-index.cjs');
const { skipWithoutRuntimeDeps } = require('../lib/test-runtime-deps.cjs');
const skip = skipWithoutRuntimeDeps();

function makeRepo(fileCount) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-semantic-index-'));
  for (let i = 0; i < fileCount; i++) {
    fs.writeFileSync(path.join(root, `doc${i}.md`), `# Doc ${i}\ncontent for doc ${i}\n`);
  }
  return root;
}

// The incremental-cache tests force each build to bypass the debounce window
// (they intentionally rebuild twice back-to-back to exercise the mtime cache).
test('second build reuses unchanged files and only re-embeds a touched one', { skip }, async (t) => {
  const root = makeRepo(4);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); shutdown(); });
  const context = createContext(root);

  const first = await buildDocIndex(context, { force: true });
  assert.strictEqual(first.updated, 4);
  assert.strictEqual(first.unchanged, 0);
  assert.strictEqual(first.skipped, 0);

  const touched = path.join(root, 'doc0.md');
  fs.writeFileSync(touched, '# Doc 0\nUPDATED content for doc 0\n');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(touched, future, future);

  const second = await buildDocIndex(context, { force: true });
  assert.strictEqual(second.updated, 1, 'only the touched file should be re-embedded');
  assert.strictEqual(second.unchanged, 3, 'the other files should be reused from cache');
  assert.strictEqual(second.skipped, 0);
});

test('a pre-v2 (mtime-less) index triggers a full rebuild instead of crashing', { skip }, async (t) => {
  const root = makeRepo(2);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); shutdown(); });
  const context = createContext(root);

  const first = await buildDocIndex(context, { force: true });
  assert.strictEqual(first.updated, 2);

  const dir = path.join(root, '.claude', 'repo-docs');
  fs.writeFileSync(path.join(dir, 'repo-docs-index.meta.json'), JSON.stringify({ schemaVersion: 1 }));

  const second = await buildDocIndex(context, { force: true });
  assert.strictEqual(second.updated, 2, 'stale schema version must force a full rebuild, not a crash');
  assert.strictEqual(second.unchanged, 0);
});

test('a rapid unforced rebuild is debounced (no re-embed)', { skip }, async (t) => {
  const root = makeRepo(2);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); shutdown(); });
  const context = createContext(root);

  const first = await buildDocIndex(context, { force: true });
  assert.strictEqual(first.updated, 2);

  // Immediate second build with no force → within the debounce window → skipped.
  const second = await buildDocIndex(context);
  assert.strictEqual(second.debounced, true, 'a rebuild within the debounce window should be skipped');
  assert.strictEqual(second.updated, 0);
  assert.strictEqual(second.unchanged, 0);
});

test('a held build lock makes a concurrent build back off (single-writer guard)', { skip }, async (t) => {
  const root = makeRepo(2);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); shutdown(); });
  const context = createContext(root);

  // Simulate another process mid-build: a fresh lock file owned by THIS process
  // (alive), so it must not be taken over by the age rule alone.
  const dir = path.join(root, '.claude', 'repo-docs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index-build.lock'), String(process.pid));

  // force bypasses debounce but must NOT bypass the lock.
  const res = await buildDocIndex(context, { force: true });
  assert.strictEqual(res.locked, true, 'a build must back off when the lock is held');
  assert.strictEqual(res.updated, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'repo-docs-index.json')), 'no index should be written while locked');
});

test('a lock owned by a dead pid is stale and gets taken over', { skip }, async (t) => {
  const root = makeRepo(2);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); shutdown(); });
  const context = createContext(root);

  // A fresh but dead-owner lock: above macOS's pid_max, so guaranteed unused.
  const dir = path.join(root, '.claude', 'repo-docs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index-build.lock'), '999999');

  const res = await buildDocIndex(context, { force: true });
  assert.ok(!res.locked, 'a dead-owner lock must be taken over, not backed off');
  assert.strictEqual(res.updated, 2);
});

// Deterministic without loading any model: an empty NODE_PATH means
// @huggingface/transformers can never resolve, so the embedder never becomes
// ready — the same condition a fresh checkout hits before the SessionStart
// hook's npm install has run.
test('buildDocIndex reports unavailable instead of silent zeros when the embedder never becomes ready', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-semantic-index-unavailable-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const emptyNodePath = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-node-path-'));
  t.after(() => fs.rmSync(emptyNodePath, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'doc.md'), '# Doc\ncontent\n');

  const driver = path.join(root, 'driver.cjs');
  fs.writeFileSync(driver, `
    'use strict';
    const { createContext } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'context.cjs'))});
    const { buildDocIndex } = require(${JSON.stringify(path.join(__dirname, 'build-semantic-index.cjs'))});
    (async () => {
      const context = createContext(${JSON.stringify(repoRoot)});
      const r = await buildDocIndex(context, { force: true });
      console.log(JSON.stringify(r));
      process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });
  `);

  const stdout = await new Promise((resolve, reject) => {
    execFile('node', [driver], {
      // No REPO_DOCS_EMBED_RETRY_MS override: waitUntilReady's own poll only
      // notices "in cooldown" on a tick where the cooldown is still active, so
      // a cooldown shorter than its 250ms poll interval (already elapsed by
      // the first tick) would defeat that fast-fail path and stall until
      // buildDocIndex's un-overridable 300s default timeoutMs. The 30s default
      // cooldown here is comfortably longer than one poll tick.
      env: { ...process.env, NODE_PATH: emptyNodePath },
      timeout: 15000,
    }, (err, out, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(out)));
  });

  const result = JSON.parse(stdout.trim().split('\n').pop());
  assert.strictEqual(result.unavailable, true);
  assert.strictEqual(result.updated, 0);
  assert.strictEqual(result.unchanged, 0);
  assert.strictEqual(result.skipped, 0);
});

// Stub @huggingface/transformers via the same NODE_PATH-in-a-child technique
// semantic-index.test.cjs uses. The stub's embed() detaches an uncaught throw
// via setImmediate on the 2nd call — that crashes the worker thread itself
// (an 'error' + 'exit' on the parent) rather than just failing the awaited
// embed() call, standing in for a real ONNX crash/OOM that the worker's own
// per-message try/catch (fix a) cannot catch.
test('a worker that dies mid-build leaves the previous (cold, absent) index untouched and reports failure', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-semantic-index-crash-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modDir = path.join(root, 'node_modules', '@huggingface', 'transformers');
  const repoRoot = path.join(root, 'repo');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'doc0.md'), '# Doc 0\ncontent for doc 0\n');
  fs.writeFileSync(path.join(repoRoot, 'doc1.md'), '# Doc 1\ncontent for doc 1\n');
  fs.writeFileSync(path.join(repoRoot, 'doc2.md'), '# Doc 2\ncontent for doc 2\n');

  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(path.join(modDir, 'package.json'),
    JSON.stringify({ name: '@huggingface/transformers', version: '0.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(modDir, 'index.js'), [
    "let calls = 0;",
    "const f = async (t, o) => {",
    "  calls++;",
    "  if (calls === 2) {",
    "    setImmediate(() => { throw new Error('simulated ONNX crash'); });",
    "    return new Promise(() => {});",
    "  }",
    "  return { data: new Array(384).fill(0) };",
    "};",
    "f.tokenizer = { _tokenizerConfig: {}, encode: (t) => String(t).split(/\\s+/) };",
    "exports.env = {};",
    "exports.pipeline = async () => f;",
  ].join('\n'));

  const indexFile = path.join(repoRoot, '.claude', 'repo-docs', 'repo-docs-index.json');
  const driver = path.join(root, 'driver.cjs');
  fs.writeFileSync(driver, `
    'use strict';
    const { createContext } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'context.cjs'))});
    const { buildDocIndex } = require(${JSON.stringify(path.join(__dirname, 'build-semantic-index.cjs'))});
    (async () => {
      const context = createContext(${JSON.stringify(repoRoot)});
      let threw = false;
      try { await buildDocIndex(context, { force: true }); }
      catch { threw = true; }
      const fs = require('node:fs');
      console.log(JSON.stringify({ threw, indexExists: fs.existsSync(${JSON.stringify(indexFile)}) }));
      process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });
  `);

  const stdout = await new Promise((resolve, reject) => {
    execFile('node', [driver], {
      env: {
        ...process.env,
        NODE_PATH: path.join(root, 'node_modules'),
        REPO_DOCS_EMBED_RETRY_MS: '50000',
        REPO_DOCS_MODELS_DIR: path.join(root, 'models'),
      },
      timeout: 30000,
    }, (err, out, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(out)));
  });

  const result = JSON.parse(stdout.trim().split('\n').pop());
  assert.strictEqual(result.threw, true, 'the build must report failure, not silently save a partial index');
  assert.strictEqual(result.indexExists, false, 'no index should be written on a cold root once the worker dies mid-build');
});
