'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODEL = require('./check-model.json');

// A real server process with a fake model: a text containing NX embeds along the weights, anything
// else against them. Vectors and the batches the server saw are logged.
const LOADER = `
'use strict';
const fs = require('node:fs');
const MODEL = require(${JSON.stringify(path.join(__dirname, 'check-model.json'))});
fs.appendFileSync(process.env.FAKE_LOG, 'pid ' + process.pid + '\\n');
exports.loadEmbedder = async () => ({
  async run(texts) {
    fs.appendFileSync(process.env.FAKE_LOG, 'batch ' + texts.length + '\\n');
    return texts.map((t) => MODEL.weights.map((w) => (t.includes('NX') ? 10 * w : -10 * w)));
  },
});
exports.loadReranker = async () => ({ score: async () => [] });
`;

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'check-server-')));
  const loader = path.join(root, 'loader.cjs');
  fs.writeFileSync(loader, LOADER);
  const log = path.join(root, 'log.txt');
  fs.writeFileSync(log, '');
  const env = { MODEL_SERVER_DIR: path.join(root, 'sock'), MODEL_SERVER_LOADER: loader, FAKE_LOG: log, MODEL_SERVER_IDLE_MS: '60000', MODEL_CLIENT_RETRY_MS: '100' };
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  const client = require('./model-client.cjs');
  const lines = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  t.after(() => {
    client.close();
    for (const l of lines()) {
      if (l.startsWith('pid ')) { try { process.kill(Number(l.slice(4)), 'SIGKILL'); } catch {} }
    }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { lines };
}

test('the fake vectors sit on either side of the cutoff', () => {
  const sq = MODEL.weights.reduce((s, w) => s + w * w, 0);
  assert.ok(MODEL.bias + 10 * sq >= MODEL.cutoff);
  assert.ok(MODEL.bias - 10 * sq < MODEL.cutoff);
});

test('markChecks marks commands from the server vectors in one call', async (t) => {
  const f = fixture(t);
  const { markChecks } = require('./check-commands.cjs');
  const commands = [
    { cmd: 'pnpm exec NX run-many -t lint', ok: true, seq: 5 },
    { cmd: 'git status --short', ok: true, seq: 5 },
    { cmd: 'git diff && ./run NX things ; git add .', ok: true, seq: 5 },
    { cmd: 'pnpm vitest run', ok: true, seq: 5 }, // known to the regex: not considered
    { cmd: 'NX too old', ok: true, seq: 1 },
    { cmd: 'NX failed', ok: false, seq: 5 },
  ];
  await markChecks(commands, 3);
  assert.deepStrictEqual(commands.map(c => c.check === true), [true, false, true, false, false, false]);
  // 1 + 1 + 3 parts, sent as one batch.
  assert.deepStrictEqual(f.lines().filter(l => l.startsWith('batch')), ['batch 5']);
});

test('markChecks falls back to the in-process embedder when the server gives nothing', async () => {
  const { markChecks } = require('./check-commands.cjs');
  const texts = [];
  const embedder = async () => async (text) => {
    texts.push(text);
    return { data: MODEL.weights.map((w) => (text.includes('NX') ? 10 * w : -10 * w)) };
  };
  const commands = [
    { cmd: 'git diff && ./run NX things ; git add .', ok: true, seq: 5 },
    { cmd: 'git status', ok: true, seq: 5 },
  ];
  await markChecks(commands, 0, { client: async () => null, embedder });
  assert.deepStrictEqual(commands.map(c => c.check === true), [true, false]);
  // Stops at the first part that scores over the cutoff, as before.
  assert.deepStrictEqual(texts, [MODEL.prefix + 'git diff', MODEL.prefix + './run NX things', MODEL.prefix + 'git status']);
});

test('markChecks with the server disabled uses the in-process embedder', async () => {
  const saved = process.env.MODEL_SERVER_DISABLE;
  process.env.MODEL_SERVER_DISABLE = '1';
  try {
    const { markChecks } = require('./check-commands.cjs');
    const commands = [{ cmd: 'NX build', ok: true, seq: 5 }];
    let used = 0;
    await markChecks(commands, 0, { embedder: async () => async (text) => { used++; return { data: MODEL.weights.map((w) => (text.includes('NX') ? 10 * w : -10 * w)) }; } });
    assert.strictEqual(used, 1);
    assert.strictEqual(commands[0].check, true);
  } finally {
    if (saved === undefined) delete process.env.MODEL_SERVER_DISABLE; else process.env.MODEL_SERVER_DISABLE = saved;
  }
});
