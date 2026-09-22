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
    // The path classes ask the filesystem now, so a fixture that wants a claim
    // to be about a real file has to make one.
    file(rel) {
      const p = path.join(home, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, 'x\n');
      return p;
    },
    transcript(calls, session) {
      const file = path.join(home, `transcript-${session}.jsonl`);
      const lines = [];
      for (const c of calls) {
        const id = `t${this.seq += 1}`;
        lines.push(JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id, name: c.name, input: c.input }] },
        }));
        // Some checks read what the tool printed, not just what it was asked.
        if (c.result !== undefined) lines.push(JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'tool_result', tool_use_id: id, content: c.result }] },
        }));
      }
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
      cwd: fx.home,
    }),
    encoding: 'utf8',
    env: { ...process.env, VERIFIED_HOME: fx.home, ...env },
  });
  return out.trim() ? JSON.parse(out) : null;
}

const blocked = (r) => !!r && r.decision === 'block';
const reason = (r) => (r && r.reason) || '';

const WITH_PATH = { VERIFIED_CONFIG: '{"path":true}' };

test('a file that is there but was never read does not block by default', () => {
  const fx = fixture();
  fx.file('src/db.ts');
  // Asking the manifest caught 48 claims across 3260 replayed turns against 202
  // the session had demonstrably already printed. The existence check stays.
  assert.strictEqual(run(fx, 'The config lives at src/db.ts:42.'), null);
});

test('path claim with no read of that file blocks', () => {
  const fx = fixture();
  fx.file('src/db.ts');
  const r = run(fx, 'The config lives at src/db.ts:42.', [], 's1', WITH_PATH);
  assert.ok(blocked(r));
  assert.match(reason(r), /\[path\] "src\/db\.ts:42"/);
});

test('a claim about a file that is not there blocks as fiction', () => {
  const fx = fixture();
  // Nothing written: the manifest has nothing to say about a path that does not
  // exist, which is exactly the claim it could never catch before.
  const r = run(fx, 'The config lives at src/nope.ts:42.');
  assert.ok(blocked(r));
  assert.match(reason(r), /\[path-missing\]/);
  assert.match(reason(r), /another one \(an SSH host/);
});

test('the remote-machine note only rides on a path-missing flag', () => {
  const fx = fixture();
  fx.file('src/db.ts');
  const r = run(fx, 'The config lives at src/db.ts:42.', [], 's1', WITH_PATH);
  assert.ok(blocked(r));
  assert.doesNotMatch(reason(r), /SSH host/);
});

test('reading a file does not excuse it having been deleted', () => {
  const fx = fixture();
  const r = run(fx, 'The config lives at src/gone.ts:42.', [
    { name: 'Read', input: { file_path: path.join(fx.home, 'src/gone.ts') } },
  ]);
  assert.ok(blocked(r));
  assert.match(reason(r), /\[path-missing\]/);
});

test('a ~ path is not read as an absolute path that cannot exist', () => {
  const fx = fixture();
  // "~/.claude/RTK.md" used to match from the slash, giving "/.claude/RTK.md",
  // an absolute path that is missing by construction. It flagged every time.
  const r = run(fx, 'It is in ~/.claude/RTK.md as documented.');
  assert.strictEqual(r, null);
});

test('an elided path inside a markdown link is not a claim', () => {
  const fx = fixture();
  const r = run(fx, 'See [libs/\u2026/drift.spec.mjs:49](tools/x) for it.');
  assert.strictEqual(r, null);
});

test('path claim backed by a Read passes', () => {
  const fx = fixture();
  const abs = fx.file('src/db.ts');
  const r = run(fx, 'The config lives at src/db.ts:42.', [
    { name: 'Read', input: { file_path: abs } },
  ]);
  assert.strictEqual(r, null);
});

test('path claim backed by a Bash cat passes', () => {
  const fx = fixture();
  fx.file('src/db.ts');
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

test('the absence class is off, on the evidence', () => {
  const fx = fixture();
  // 66 flags across 3260 replayed turns and not one that any signal could
  // confirm in either direction. It spent blocked turns and returned nothing.
  const r = run(fx, 'There is no retry logic.');
  assert.strictEqual(r, null);
});

test('a test runner pass line in output backs "tests pass"', () => {
  const fx = fixture();
  // The command pattern only knows the runners it names. 33 of the measured
  // command-outcome false positives had the runner's own pass line in output
  // while TEST_CMD_RE matched nothing.
  const r = run(fx, 'All 14 tests pass.', [
    { name: 'Bash', input: { command: 'make verify' }, result: 'Tests: 14 passed, 14 total' },
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
  ], 'stale', WITH_PATH), null);

  // The file changes. The old read no longer describes what is there.
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(target, 'export const a = 2;\n');
  fs.utimesSync(target, later, later);

  const r = run(fx, `The value is at ${target}:1.`, [
    { name: 'Bash', input: { command: 'echo unrelated' } },
  ], 'stale', WITH_PATH);
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
  const found = classify('It lives at /Users/me/repo/src/db.ts:42.', bare, { path: true, pathMissing: false }).unbacked;
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].span, '/Users/me/repo/src/db.ts:42');
  // A URL is URL_RE's job; PATH_RE must not also claim it.
  const url = classify('See https://example.com/docs/x.js for the shape.', bare, { path: true, pathMissing: false }).unbacked;
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
        evidence: { paths: [], commands: [], searches: [], urls: [], libLookup: false, seq: 1, lastWrite: 0, cwd: '/' },
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

// ---- mentioning a claim is not making one ----------------------------------
// Both of these blocked a real turn. Writing about what the gate looks for is
// not asserting it, and the scorer shares the definition so it cannot credit
// one of these as a catch either.

test('a format example is not a path claim', () => {
  const fx = fixture();
  const r = run(fx, 'Spans come out looking like `src/x.ts:12` in the reason string.');
  assert.strictEqual(r, null);
});

test('a quoted phrase is not an outcome claim', () => {
  const fx = fixture();
  const r = run(fx, 'It fires on a claim like "tests pass" when no test ran.');
  assert.strictEqual(r, null);
});

test('using a placeholder-shaped name unquoted is still a claim', () => {
  const fx = fixture();
  // lib/a.cjs is an ordinary filename, and an unquoted src/nope.ts is asserted.
  const r = run(fx, 'The bug is in src/nope.ts:12.');
  assert.ok(blocked(r));
  assert.match(reason(r), /\[path-missing\]/);
});

test('an outcome claim outside quotes still blocks', () => {
  const fx = fixture();
  const r = run(fx, 'All 14 tests pass.');
  assert.ok(blocked(r));
  assert.match(reason(r), /\[command-outcome\]/);
});

test('a quoted span with words in front of the match is still a mention', () => {
  const fx = fixture();
  // The first version compared the two characters touching the match, so
  // "21 tests pass" read as unquoted: what touches the match is "1 ".
  const r = run(fx, 'Both "tests pass" and "21 tests pass" are quoted from an earlier block.');
  assert.strictEqual(r, null);
});

test('one unquoted use makes it a claim even when also quoted', () => {
  const fx = fixture();
  const r = run(fx, 'I quote "tests pass" here, but also: the tests pass now.');
  assert.ok(blocked(r));
  assert.match(reason(r), /\[command-outcome\]/);
});

test('a path introduced as an example is a mention, not a claim', () => {
  const fx = fixture();
  // Six blocks in one session on a well-known filename used as a concept.
  const r = run(fx, 'Plugins cannot ship an instruction file, e.g. AGENTS.md at the root, or a file called SKILL.md.');
  assert.strictEqual(r, null);
});

test('an example marker on one use does not excuse an unmarked use', () => {
  const fx = fixture();
  const r = run(fx, 'Names like e.g. src/nope.ts are fine, but the bug is in src/nope.ts:12.');
  assert.ok(blocked(r));
  assert.match(reason(r), /\[path-missing\]/);
});
