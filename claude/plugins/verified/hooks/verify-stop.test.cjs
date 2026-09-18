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
    // One transcript per session, appended to — the shape Claude Code actually
    // writes. Rewriting it in place let a same-size replacement slip past the
    // byte offset, which read as a product bug and was not one.
    seq: 0,
    transcript(calls, session) {
      const file = path.join(home, `transcript-${session}.jsonl`);
      const lines = calls.map((c) =>
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id: `t${this.seq += 1}`, name: c.name, input: c.input }] },
        }),
      );
      fs.appendFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''));
      if (!fs.existsSync(file)) fs.writeFileSync(file, '');
      return file;
    },
  };
}

function run(fx, answer, calls = [], session = 's1', env = {}) {
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: session,
      transcript_path: fx.transcript(calls, session),
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

  // One node is not a sample. Scoring it would invent a number, so it refuses.
  const out = execFileSync('node', [REPLAY], {
    encoding: 'utf8',
    env: { ...process.env, VERIFIED_HOME: fx.home },
  });
  assert.match(out, /too few to score/);
  assert.match(out, /--corpus/, 'points at the source that does have enough history');
});

test('replay rejects a candidate that scores worse', () => {
  const fx = fixture();
  // Enough nodes to be worth scoring, each a claim the session never went on to
  // check, so the current config catches nothing a blind one would miss.
  const nodes = [];
  for (let i = 0; i < 25; i += 1) {
    nodes.push(JSON.stringify({
      ts: new Date().toISOString(), session: `s${i}`, action: 'block',
      answer: `The value is at src/mod${i}.ts:7.`,
      evidence: { paths: [`src/mod${i}.ts`], commands: [], searches: [], urls: [], libLookup: false, seq: 1, lastWrite: 0 },
      claims: [],
    }));
  }
  fs.writeFileSync(path.join(fx.home, 'ledger.jsonl'), nodes.join('\n') + '\n');

  // A candidate that flags everything: every flag is unconfirmed, so it pays
  // the full cost and earns nothing.
  const noisy = path.join(fx.home, 'noisy.cjs');
  fs.writeFileSync(noisy, 'module.exports={classify:(a)=>({unbacked:[{class:"path",span:"x.ts",needs:"n"}],residualText:""})};\n');

  let out = '', code = 0;
  try {
    out = execFileSync('node', [REPLAY, '--candidate', noisy], {
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
  // The version class ships off, so ask for it explicitly: the point under test
  // is that libLookup is what backs it, not whether it is enabled by default.
  const on = { version: true };
  assert.strictEqual(classify('Upgrade to v2.1.0 first.', bare, on).unbacked.length, 1);
  const viaMcp = { ...bare, libLookup: true };
  assert.strictEqual(classify('Upgrade to v2.1.0 first.', viaMcp, on).unbacked.length, 0);
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

test('a read goes stale when the file changes underneath it', () => {
  const fx = fixture();
  const target = path.join(fx.home, 'config.ts');
  fs.writeFileSync(target, 'export const a = 1;\n');

  // Turn 1 reads it, so a claim about it is backed.
  assert.strictEqual(run(fx, `The value is at ${target}:1.`, [
    { name: 'Read', input: { file_path: target } },
  ], 'stale'), null);

  // The file changes. The old read no longer describes what is there.
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(target, 'export const a = 2;\n');
  fs.utimesSync(target, later, later);

  const r = run(fx, `The value is at ${target}:1.`, [
    { name: 'Bash', input: { command: 'echo unrelated' } },
  ], 'stale');
  assert.ok(r && r.decision === 'block', 'the stale read no longer backs the claim');
});

test('a clean test run is invalidated by a later edit', () => {
  const fx = fixture();
  assert.strictEqual(run(fx, 'Running them.', [
    { name: 'Bash', input: { command: 'npm test' } },
  ], 'order'), null);

  const r = run(fx, 'All 14 tests pass.', [
    { name: 'Edit', input: { file_path: '/repo/src/db.ts' } },
  ], 'order');
  assert.ok(r && r.decision === 'block');
  assert.match(r.reason, /re-running it/, 'says the run predates the write, not that nothing ran');
});

test('re-running after the edit clears it', () => {
  const fx = fixture();
  run(fx, 'Editing.', [{ name: 'Edit', input: { file_path: '/repo/src/db.ts' } }], 'order2');
  const r = run(fx, 'All 14 tests pass.', [
    { name: 'Bash', input: { command: 'npm test' } },
  ], 'order2');
  assert.strictEqual(r, null);
});

test('an absolute path is a claim like any other', () => {
  const { classify } = require('./claim-patterns.cjs');
  const bare = { paths: new Set(), commands: [], searches: [], urls: new Set(), libLookup: false };
  const found = classify('It lives at /Users/me/repo/src/db.ts:42.', bare).unbacked;
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].span, '/Users/me/repo/src/db.ts:42');
  // A URL is URL_RE's job; PATH_RE must not also claim it.
  const url = classify('See https://example.com/docs/x.js for the shape.', bare).unbacked;
  assert.deepStrictEqual(url.map((u) => u.class), ['url']);
});

test('a long session keeps its manifest bounded and its stamps aligned', () => {
  const fx = fixture();
  const ledger = require('./ledger.cjs');
  process.env.VERIFIED_HOME = fx.home;
  const ev = { paths: new Set(), commands: [], searches: [], urls: new Set(), libLookup: false, stamps: {}, seq: 0, lastWrite: 0 };
  for (let i = 0; i < 20; i += 1) {
    ev.paths.add(`/repo/f${i}.ts`);
    ev.stamps[`/repo/f${i}.ts`] = i;
    // Full command text is never needed: the regexes match the program name.
    ev.commands.push({ cmd: 'npm test ' + 'x'.repeat(5000), ok: true, seq: i });
  }
  ledger.writeManifest('long', ev);
  const back = ledger.readManifest('long');
  assert.ok(back.commands[0].cmd.length <= 300, 'command text is truncated on the way to disk');
  assert.ok(back.commands[0].cmd.startsWith('npm test'), 'the part the regexes read survives');
  assert.strictEqual(Object.keys(back.stamps).length, back.paths.size, 'no stamp outlives its path');
});

// ---- the fixed history -----------------------------------------------------
// Dream-RSI's no-regress bound is stated over a fixed history (p.6). Scoring the
// N most recent transcripts is not one: measured over this user's sessions the
// sweep winner moved from absenceAfterWrite=true to absence=false to path=false
// as N grew, so a config that shipped on one draw would lose on the next.

function pinnable() {
  const fx = fixture();
  const proj = path.join(fx.home, '.claude', 'projects', 'p');
  fs.mkdirSync(proj, { recursive: true });
  fx.vh = path.join(fx.home, 'vh');
  fx.session = path.join(proj, 'a.jsonl');
  fx.turn = (name, input, text) => {
    fs.appendFileSync(fx.session, [
      JSON.stringify({ type: 'user', message: { content: 'go' } }),
      JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'tool_use', id: `t${fx.seq += 1}`, name, input },
        { type: 'text', text },
      ] } }),
    ].join('\n') + '\n');
  };
  fx.replay = (...args) => execFileSync('node', [REPLAY, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: fx.home, VERIFIED_HOME: fx.vh },
  });
  return fx;
}

test('a pinned history scores the same worlds whatever limit is asked for', () => {
  const fx = pinnable();
  fx.turn('Read', { file_path: '/x/a.ts' }, 'It is at src/one.ts:3.');
  fx.turn('Read', { file_path: '/x/b.ts' }, 'It is at src/two.ts:4.');
  fx.replay('--pin');

  const counts = ['1', '5', '500'].map((n) => fx.replay('--corpus', n).match(/replayed (\d+) turns/)[1]);
  assert.deepStrictEqual(counts, [counts[0], counts[0], counts[0]],
    'the limit must not change the world set once it is pinned');
  assert.match(fx.replay('--corpus'), /pinned worlds/);
});

test('a pinned world does not grow when its session keeps running', () => {
  const fx = pinnable();
  fx.turn('Read', { file_path: '/x/a.ts' }, 'It is at src/one.ts:3.');
  fx.replay('--pin');
  const before = fx.replay('--corpus').match(/replayed (\d+) turns/)[1];

  fx.turn('Read', { file_path: '/x/b.ts' }, 'It is at src/two.ts:4.');
  fx.turn('Read', { file_path: '/x/c.ts' }, 'It is at src/three.ts:5.');
  assert.strictEqual(fx.replay('--corpus').match(/replayed (\d+) turns/)[1], before,
    'the lock records a byte length, so a live transcript cannot change a world');
});

test('a bare --corpus replays the default, not one transcript', () => {
  const fx = pinnable();
  fx.turn('Read', { file_path: '/x/a.ts' }, 'It is at src/one.ts:3.');
  // No lock, so this takes the recent-transcripts path, where `arg` used to hand
  // Number() a boolean and quietly score a single session.
  assert.match(fx.replay('--corpus'), /from the 120 most recent/);
});

test('a block the gate resolved outscores the same block it did not', () => {
  const nodes = (resolved) => {
    const out = [];
    for (let i = 0; i < 25; i += 1) {
      out.push(JSON.stringify({
        ts: new Date().toISOString(), session: `s${i}`, action: 'block', resolved,
        answer: `The value is at src/mod${i}.ts:7.`,
        evidence: { paths: [], commands: [], searches: [], urls: [], libLookup: false, seq: 1, lastWrite: 0 },
        claims: [{ class: 'path', span: `src/mod${i}.ts:7` }],
      }));
    }
    return out.join('\n') + '\n';
  };
  const V = (resolved) => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.home, 'ledger.jsonl'), nodes(resolved));
    const out = execFileSync('node', [REPLAY], { encoding: 'utf8', env: { ...process.env, VERIFIED_HOME: fx.home } });
    return Number(out.match(/V=\s*(-?[\d.]+)/)[1]);
  };
  // The recorded outcome is the only label here that is not a proxy, so it has
  // to move the score. Before, replay never read it and both scored identically.
  assert.ok(V(true) > V(false), `resolved block should score higher: ${V(true)} vs ${V(false)}`);
});
