'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'verify-stop.cjs');
const REPLAY = path.join(__dirname, 'replay.cjs');

// Answers here stay short on purpose: the residual judge only fires on more than
// 80 characters of unclassified text, so these exercise stages 1-2 without
// spawning a model.
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'verified-'));
  return {
    home,
    // Each entry is one tool call the session made.
    transcript(calls) {
      const file = path.join(home, 'transcript.jsonl');
      const lines = calls.map((c, i) =>
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id: `t${i}`, name: c.name, input: c.input }] },
        }),
      );
      fs.writeFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''));
      return file;
    },
  };
}

function run(fx, answer, calls = [], session = 's1', env = {}) {
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: session,
      transcript_path: fx.transcript(calls),
      last_assistant_message: answer,
    }),
    encoding: 'utf8',
    env: { ...process.env, VERIFIED_HOME: fx.home, ...env },
  });
  return out.trim() ? JSON.parse(out) : null;
}

const blocked = (r) => !!r && r.decision === 'block';
const reason = (r) => (r && r.reason) || '';

test('path claim with no read of that file blocks', () => {
  const fx = fixture();
  const r = run(fx, 'The config lives at src/db.ts:42.');
  assert.ok(blocked(r));
  assert.match(reason(r), /src\/db\.ts:42/);
});

test('path claim backed by a Read passes', () => {
  const fx = fixture();
  const r = run(fx, 'The config lives at src/db.ts:42.', [
    { name: 'Read', input: { file_path: '/repo/src/db.ts' } },
  ]);
  assert.strictEqual(r, null);
});

test('path claim backed by a Bash cat passes', () => {
  const fx = fixture();
  const r = run(fx, 'The config lives at src/db.ts:42.', [
    { name: 'Bash', input: { command: 'rtk read src/db.ts' } },
  ]);
  assert.strictEqual(r, null);
});

test('"tests pass" with no test run blocks', () => {
  const fx = fixture();
  const r = run(fx, 'All 14 tests pass.');
  assert.ok(blocked(r));
  assert.match(reason(r), /command-outcome/);
});

test('"tests pass" backed by a real test command passes', () => {
  const fx = fixture();
  const r = run(fx, 'All 14 tests pass.', [
    { name: 'Bash', input: { command: 'npm test' } },
  ]);
  assert.strictEqual(r, null);
});

test('"tests pass" is not backed by a test command that errored', () => {
  const fx = fixture();
  const file = path.join(fx.home, 'transcript.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'npm test' } }] },
    }),
    JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'a', is_error: true }] },
    }),
  ].join('\n') + '\n');
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'err',
      transcript_path: file,
      last_assistant_message: 'All 14 tests pass.',
    }),
    encoding: 'utf8',
    env: { ...process.env, VERIFIED_HOME: fx.home },
  });
  assert.ok(blocked(JSON.parse(out)));
});

test('absence claim with no search blocks', () => {
  const fx = fixture();
  const r = run(fx, 'There is no retry logic.');
  assert.ok(blocked(r));
  assert.match(reason(r), /absence/);
});

test('absence claim backed by a Grep passes', () => {
  const fx = fixture();
  const r = run(fx, 'There is no retry logic.', [
    { name: 'Grep', input: { pattern: 'retry' } },
  ]);
  assert.strictEqual(r, null);
});

test('an opinion does not block', () => {
  const fx = fixture();
  const r = run(fx, "I'd go with Postgres, it suits the access pattern.");
  assert.strictEqual(r, null);
});

test('a path inside a fenced code block is illustration, not a claim', () => {
  const fx = fixture();
  const r = run(fx, 'Try this:\n```sh\ncat src/db.ts\n```\n');
  assert.strictEqual(r, null);
});

test('an uncited URL blocks, a fetched one passes', () => {
  const fx = fixture();
  assert.ok(blocked(run(fx, 'See https://example.com/docs/x.', [], 'u1')));
  const fx2 = fixture();
  const r = run(fx2, 'See https://example.com/docs/x.', [
    { name: 'WebFetch', input: { url: 'https://example.com/docs/x' } },
  ], 'u2');
  assert.strictEqual(r, null);
});

test('the reentry guard stops the judge child from recursing', () => {
  const fx = fixture();
  const r = run(fx, 'The config lives at src/db.ts:42.', [], 's-guard', { VERIFIED_JUDGE: '1' });
  assert.strictEqual(r, null);
});

test('an empty answer is not a claim', () => {
  const fx = fixture();
  assert.strictEqual(run(fx, '   '), null);
});

test('a malformed transcript fails open rather than taking the turn down', () => {
  const fx = fixture();
  const file = path.join(fx.home, 'bad.jsonl');
  fs.writeFileSync(file, 'not json at all\n{"also":\n');
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'bad',
      transcript_path: file,
      last_assistant_message: "I'd go with Postgres.",
    }),
    encoding: 'utf8',
    env: { ...process.env, VERIFIED_HOME: fx.home },
  });
  assert.strictEqual(out.trim(), '');
});

test('the ledger records a node that replay can score', () => {
  const fx = fixture();
  run(fx, 'The config lives at src/db.ts:42.', [], 'led');
  const nodes = fs.readFileSync(path.join(fx.home, 'ledger.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(nodes.length, 1);
  assert.strictEqual(nodes[0].action, 'block');
  assert.ok(nodes[0].answer, 'node carries the answer so a candidate config can be replayed');
  assert.ok(nodes[0].evidence, 'node carries the manifest for the same reason');

  const out = execFileSync('node', [REPLAY], {
    encoding: 'utf8',
    env: { ...process.env, VERIFIED_HOME: fx.home },
  });
  assert.match(out, /replayed 1 stored turns/);
  assert.match(out, /current\s+V=/);
});

test('replay rejects a candidate that scores worse', () => {
  const fx = fixture();
  // One block that the next turn did fix: a true catch under the current config.
  run(fx, 'The config lives at src/db.ts:42.', [], 'r1');
  run(fx, 'Rechecked, it is elsewhere.', [], 'r1');

  // A candidate that never flags anything cannot catch it, so it scores lower.
  const blind = path.join(fx.home, 'blind.cjs');
  fs.writeFileSync(blind, 'module.exports={classify:()=>({unbacked:[],residualText:""})};\n');

  let out = '', code = 0;
  try {
    out = execFileSync('node', [REPLAY, '--candidate', blind], {
      encoding: 'utf8',
      env: { ...process.env, VERIFIED_HOME: fx.home },
    });
  } catch (e) {
    out = e.stdout || '';
    code = e.status;
  }
  assert.match(out, /REJECT/);
  assert.strictEqual(code, 1, 'a rejected candidate exits non-zero so a script cannot ship it by accident');
});
