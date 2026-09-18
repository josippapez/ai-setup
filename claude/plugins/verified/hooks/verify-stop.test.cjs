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

test('a sentence a pattern already handled is not also sent to the judge', () => {
  const { classify } = require('./claim-patterns.cjs');
  const ev = { paths: new Set(['src/db.ts']), commands: [], searches: [], urls: new Set(), libLookup: false };
  const { residualText } = classify(
    'The config lives at src/db.ts:42. Redis uses an approximated LRU.',
    ev,
  );
  assert.ok(!residualText.includes('config lives at'), 'handled sentence is dropped whole');
  assert.ok(residualText.includes('Redis'), 'untouched sentence still reaches the judge');
  assert.ok(!/`\s+`|at\s+\.\s/.test(residualText), 'no spliced-out fragment left behind');
});

test('stage 3 is off by default and opts in by env var', () => {
  const fx = fixture();
  // Residual well past the 80-char threshold with no stage-2 pattern in it.
  const answer =
    'Redis evicts keys using an approximated LRU rather than a true LRU, sampling ' +
    'a handful of candidates on each eviction instead of scanning every key.';
  const t0 = Date.now();
  assert.strictEqual(run(fx, answer, [], 'off'), null, 'default: no judge, nothing blocks');
  assert.ok(Date.now() - t0 < 3000, 'default path never spawns a model (would take 5-56s)');
});

test('a zero-tool conversational turn is never judged', () => {
  const fx = fixture();
  // Judge on, but nothing was gathered: there is no manifest to check against.
  const answer =
    'Redis evicts keys using an approximated LRU rather than a true LRU, sampling ' +
    'a handful of candidates on each eviction instead of scanning every key.';
  const t0 = Date.now();
  assert.strictEqual(run(fx, answer, [], 'notools', { VERIFIED_JUDGE_ENABLED: '1' }), null);
  assert.ok(Date.now() - t0 < 3000, 'no model spawned on a turn that gathered nothing');
});

test('first and second person sentences never reach the judge', () => {
  const fx = fixture();
  // A turn that DID gather something, so the zero-tool gate is not what saves it.
  const answer =
    'I did not see the conversation behind that line, so tell me if it is wrong. ' +
    "You were getting session recaps that nobody could read the next morning. " +
    "We should probably revisit this once the ledger has some real data in it.";
  const t0 = Date.now();
  assert.strictEqual(
    run(fx, answer, [{ name: 'Bash', input: { command: 'ls -la' } }], 'convo', { VERIFIED_JUDGE_ENABLED: '1' }),
    null,
  );
  assert.ok(Date.now() - t0 < 3000, 'every sentence filtered out, so no model spawned');
});

test('an MCP tool call counts as external evidence', () => {
  const { classify } = require('./claim-patterns.cjs');
  const bare = { paths: new Set(), commands: [], searches: [], urls: new Set(), libLookup: false };
  assert.strictEqual(classify('Upgrade to v2.1.0 first.', bare).unbacked.length, 1);
  // Same claim, after a turn that read something through an MCP server.
  const viaMcp = { ...bare, libLookup: true };
  assert.strictEqual(classify('Upgrade to v2.1.0 first.', viaMcp).unbacked.length, 0);
});

test('reading the file that declares a version backs a claim about it', () => {
  const fx = fixture();
  // The gate blocked twice on version strings the same turn had just read out
  // of a plugin.json, because MANIFEST_RE only listed package manifests.
  const r = run(fx, 'The plugin is at 0.1.3 now.', [
    { name: 'Read', input: { file_path: '/repo/.claude-plugin/plugin.json' } },
  ], 'ver');
  assert.strictEqual(r, null);
});

test('evidence carries across turns within a session', () => {
  const fx = fixture();
  // Turn 1 runs the tests. The transcript helper rewrites the file each call, so
  // turn 2 sees a transcript with no test command in it at all.
  assert.strictEqual(run(fx, 'Running them now.', [{ name: 'Bash', input: { command: 'npm test' } }], 'multi'), null);
  // Turn 2 reports the result. Per-turn scoping blocked this; session scoping does not.
  assert.strictEqual(run(fx, 'All 14 tests pass.', [{ name: 'Bash', input: { command: 'echo done' } }], 'multi'), null);
});

test('a different session does not inherit the first one evidence', () => {
  const fx = fixture();
  run(fx, 'Running them now.', [{ name: 'Bash', input: { command: 'npm test' } }], 'sess-a');
  const r = run(fx, 'All 14 tests pass.', [{ name: 'Bash', input: { command: 'echo done' } }], 'sess-b');
  assert.ok(r && r.decision === 'block', 'evidence is scoped to its own session');
});
