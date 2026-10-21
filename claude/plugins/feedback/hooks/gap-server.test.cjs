'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MODEL = require('./gap-model.json');
const { vectorFor } = require('./gap-nudge.cjs');

// A real server process with a fake model: a text containing HIGH embeds along the weights, anything
// else against them, so the score lands far above or below the cutoff.
const LOADER = `
'use strict';
const fs = require('node:fs');
const MODEL = require(${JSON.stringify(path.join(__dirname, 'gap-model.json'))});
fs.appendFileSync(process.env.FAKE_LOG, 'pid ' + process.pid + '\\n');
exports.loadEmbedder = async () => ({
  async run(texts) { return texts.map((t) => MODEL.weights.map((w) => (t.includes('HIGH') ? 10 * w : -10 * w))); },
});
exports.loadReranker = async () => ({ score: async () => [] });
`;

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gap-server-')));
  const loader = path.join(root, 'loader.cjs');
  fs.writeFileSync(loader, LOADER);
  const log = path.join(root, 'log.txt');
  fs.writeFileSync(log, '');
  const transcript = path.join(root, 't.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } }) + '\n');
  t.after(() => {
    for (const l of fs.readFileSync(log, 'utf8').split('\n')) {
      if (l.startsWith('pid ')) { try { process.kill(Number(l.slice(4)), 'SIGKILL'); } catch {} }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const env = { ...process.env, MODEL_SERVER_DIR: path.join(root, 'sock'), MODEL_SERVER_LOADER: loader, FAKE_LOG: log, MODEL_SERVER_IDLE_MS: '60000' };
  delete env.MODEL_SERVER_DISABLE;
  const run = (message) => spawnSync(process.execPath, [path.join(__dirname, 'gap-nudge.cjs')], {
    env, encoding: 'utf8', timeout: 20000,
    input: JSON.stringify({ last_assistant_message: message, transcript_path: transcript }),
  });
  return { run };
}

test('the fake vectors sit on either side of the cutoff', () => {
  const sq = MODEL.weights.reduce((s, w) => s + w * w, 0);
  assert.ok(MODEL.bias + 10 * sq >= MODEL.cutoff);
  assert.ok(MODEL.bias - 10 * sq < MODEL.cutoff);
});

test('the hook nudges when the server vector scores above the cutoff and stays silent below it', (t) => {
  const f = fixture(t);
  const high = f.run('the doc was stale HIGH');
  assert.match(high.stdout, /collect_feedback/);
  const low = f.run('all good');
  assert.strictEqual(low.stdout, '');
});

test('vectorFor falls back to the in-process embed when the server gives nothing', async () => {
  const seen = [];
  const local = async (text) => { seen.push(text); return [1, 2]; };
  assert.deepStrictEqual(await vectorFor('abc', { client: async () => null, local }), [1, 2]);
  assert.deepStrictEqual(await vectorFor('abc', { client: async () => ({ vectors: [null] }), local }), [1, 2]);
  assert.deepStrictEqual(await vectorFor('abc', { client: async () => { throw new Error('x'); }, local }), [1, 2]);
  assert.strictEqual(seen.length, 3);
});

test('vectorFor sends the same text as the in-process path and uses the server vector', async () => {
  let sent;
  const v = await vectorFor('z'.repeat(MODEL.maxChars + 50), {
    client: async (o) => { sent = o; return { vectors: [[7]] }; },
    local: async () => { throw new Error('should not load the model'); },
  });
  assert.deepStrictEqual(v, [7]);
  assert.deepStrictEqual(sent.texts, [MODEL.prefix + 'z'.repeat(MODEL.maxChars)]);
  assert.strictEqual(sent.pooling, 'mean');
  assert.strictEqual(sent.normalize, true);
  assert.strictEqual(sent.priority, 'query');
  assert.strictEqual(sent.load.dtype, MODEL.dtype);
});
