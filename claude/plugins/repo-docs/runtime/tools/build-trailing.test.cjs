'use strict';

// A skipped build (debounced or locked) must be followed by one trailing build.
// The embedder is stubbed on semantic-index's exports before the build module
// destructures them, so these run without the model deps.
process.env.MODEL_SERVER_DISABLE = '1';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const sem = require('../lib/semantic-index.cjs');

let embedCalls = 0;
sem.waitUntilReady = async () => true;
sem.isReady = () => true;
sem.embedDocsChunks = async (docs) => {
  embedCalls += 1;
  return docs.map(d => [{ headingPath: 'h', text: d.text, startLine: 1, vector: new Array(384).fill(0.1), ctxVector: new Array(384).fill(0.1) }]);
};

const { createContext } = require('../lib/context.cjs');
const { CONFIG_DIR } = require('../lib/platform.cjs');
const { buildDocIndex, cancelTrailingBuilds, indexPath } = require('./build-semantic-index.cjs');

const until = async (cond, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await new Promise(r => setTimeout(r, 50)); }
  return cond();
};
const indexHas = (context, word) => { try { return fs.readFileSync(indexPath(context), 'utf8').includes(word); } catch { return false; } };
const repoDir = (root) => path.join(root, CONFIG_DIR, 'repo-docs');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-trailing-'));
  fs.writeFileSync(path.join(root, 'a.md'), '# A\nfirstword\n');
  t.after(() => { cancelTrailingBuilds(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, context: createContext(root) };
}
function edit(root, text) {
  const f = path.join(root, 'a.md');
  fs.writeFileSync(f, text);
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(f, future, future);
}

test('a debounced call is followed by a trailing build that indexes the edit', async (t) => {
  const { root, context } = setup(t);
  await buildDocIndex(context, { force: true });
  edit(root, '# A\nsecondword\n');
  // Pretend the last build ended 4.5 s ago, so the window closes in 0.5 s.
  fs.writeFileSync(path.join(repoDir(root), 'index-build.stamp'), String(Date.now() - 4500));
  const res = await buildDocIndex(context);
  assert.strictEqual(res.debounced, true);
  assert.ok(!indexHas(context, 'secondword'));
  assert.ok(await until(() => indexHas(context, 'secondword'), 4000), 'the edit must be indexed without another trigger');
});

test('a locked call is followed by a trailing build once the lock is released', async (t) => {
  const { root, context } = setup(t);
  await buildDocIndex(context, { force: true });
  edit(root, '# A\nthirdword\n');
  const lock = path.join(repoDir(root), 'index-build.lock');
  fs.writeFileSync(lock, String(process.pid));
  const res = await buildDocIndex(context, { force: true });
  assert.strictEqual(res.locked, true);
  fs.rmSync(lock);
  // The build that just ended may still be inside the debounce window; clear it.
  fs.rmSync(path.join(repoDir(root), 'index-build.stamp'), { force: true });
  assert.ok(await until(() => indexHas(context, 'thirdword'), 6000), 'the edit must be indexed after the lock frees');
});

test('several skipped calls schedule only one trailing build', async (t) => {
  const { root, context } = setup(t);
  await buildDocIndex(context, { force: true });
  edit(root, '# A\nfourthword\n');
  fs.writeFileSync(path.join(repoDir(root), 'index-build.stamp'), String(Date.now() - 4500));
  const before = embedCalls;
  for (let i = 0; i < 5; i++) assert.strictEqual((await buildDocIndex(context)).debounced, true);
  assert.ok(await until(() => indexHas(context, 'fourthword'), 4000));
  await new Promise(r => setTimeout(r, 1500)); // a second trailing build would land by now
  assert.strictEqual(embedCalls - before, 1, 'five skipped calls must produce one build, embedding the edited file once');
});
