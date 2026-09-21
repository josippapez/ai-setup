'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'link-rules.cjs');
const DIGEST_HOOK = path.join(__dirname, 'inject-rules-digest.cjs');

function pluginRoot(rules, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'link-rules-'));
  fs.mkdirSync(path.join(root, 'rules'));
  for (const [file, body] of Object.entries(rules)) {
    fs.writeFileSync(path.join(root, 'rules', file), body);
  }
  if (name) {
    fs.mkdirSync(path.join(root, '.claude-plugin'));
    fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
  }
  return root;
}

// Every run gets its own HOME and data dir, so the test never touches the real
// ~/.claude/rules or a real plugin's data. `claude plugin list --json` is
// answered by a stub on PATH that prints FAKE_PLUGIN_LIST, or fails without it.
function fixture(rules, name = 'probe') {
  const root = pluginRoot(rules, name);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'link-rules-home-'));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\n[ -n "$FAKE_PLUGIN_LIST" ] || exit 1\nprintf "%s" "$FAKE_PLUGIN_LIST"\n', { mode: 0o755 });
  const data = path.join(home, '.claude', 'plugins', 'data', `${name}-mkt`);
  fs.mkdirSync(data, { recursive: true });
  return { root, data, home, bin, link: path.join(home, '.claude', 'rules', name) };
}

function run(fx, { shard = 0, event = 'SessionStart', session = 's1', env = {} } = {}) {
  const out = execFileSync('node', [HOOK, String(shard), event], {
    input: JSON.stringify({ session_id: session, hook_event_name: event }),
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, CLAUDE_PLUGIN_ROOT: fx.root, CLAUDE_PLUGIN_DATA: fx.data, HOME: fx.home, ...env },
    encoding: 'utf8',
  });
  return out.trim() ? JSON.parse(out).hookSpecificOutput : null;
}

test('rules are copied into the data dir and ~/.claude/rules/<plugin> points at the copy', () => {
  const fx = fixture({ 'a.md': 'rule a', 'b.md': 'rule b' });
  run(fx);
  assert.strictEqual(fs.readlinkSync(fx.link), path.join(fx.data, 'rules'));
  assert.deepStrictEqual(fs.readdirSync(fx.link).sort(), ['a.md', 'b.md']);
  assert.strictEqual(fs.readFileSync(path.join(fx.link, 'a.md'), 'utf8'), 'rule a');
});

test('a rule removed from the plugin disappears from the copy on the next run', () => {
  const fx = fixture({ 'a.md': 'x', 'b.md': 'y' });
  run(fx);
  fs.unlinkSync(path.join(fx.root, 'rules', 'b.md'));
  run(fx, { session: 's2' });
  assert.deepStrictEqual(fs.readdirSync(fx.link), ['a.md']);
});

test('a refresh keeps the rules directory and its files in place, never emptying it', () => {
  const fx = fixture({ 'a.md': 'v1' });
  run(fx);
  const dir = fs.statSync(path.join(fx.data, 'rules')).ino;
  const before = fs.statSync(path.join(fx.link, 'a.md')).ino;
  fs.writeFileSync(path.join(fx.root, 'rules', 'a.md'), 'v2');
  run(fx, { session: 's2' });
  assert.strictEqual(fs.statSync(path.join(fx.data, 'rules')).ino, dir, 'directory was recreated');
  assert.strictEqual(fs.readFileSync(path.join(fx.link, 'a.md'), 'utf8'), 'v2');
  assert.notStrictEqual(fs.statSync(path.join(fx.link, 'a.md')).ino, before, 'file was swapped in by rename, not rewritten in place');
  assert.deepStrictEqual(fs.readdirSync(fx.link), ['a.md']);
});

test('the session that publishes the link gets the rules as context; the next one does not', () => {
  const fx = fixture({ 'a.md': 'rule a' });
  const first = run(fx, { session: 's1' });
  assert.strictEqual(first.hookEventName, 'SessionStart');
  assert.match(first.additionalContext, /rule a/);
  assert.match(first.additionalContext, /load natively from ~\/\.claude\/rules\/probe\//);
  assert.strictEqual(run(fx, { session: 's2' }), null);
});

test('subagents in the publishing session get the rules too, and rely on the native copy after', () => {
  const fx = fixture({ 'a.md': 'rule a' });
  run(fx, { session: 's1' });
  const sub = run(fx, { event: 'SubagentStart', session: 's1' });
  assert.strictEqual(sub.hookEventName, 'SubagentStart');
  assert.match(sub.additionalContext, /they apply to this task/);
  assert.strictEqual(run(fx, { event: 'SubagentStart', session: 's2' }), null);
});

test('a later shard emits its part whether it runs before or after shard 0', () => {
  const fx = fixture({ 'a.md': 'A'.repeat(8000), 'b.md': 'B'.repeat(8000) });
  assert.match(run(fx, { shard: 1, session: 's1' }).additionalContext, /part 2 of 2/); // before: no link yet
  assert.match(run(fx, { shard: 0, session: 's1' }).additionalContext, /part 1/);
  assert.match(run(fx, { shard: 1, session: 's1' }).additionalContext, /part 2 of 2/); // after: marker
  assert.strictEqual(run(fx, { shard: 1, session: 's2' }), null);
  assert.strictEqual(run(fx, { shard: 5, session: 's1' }), null); // spare slot
});

test('every shard stays under the 10,000-character cap', () => {
  const fx = fixture({ 'a.md': 'A'.repeat(8000), 'b.md': 'B'.repeat(8000), 'c.md': 'C'.repeat(8000) });
  for (let i = 0; i < 4; i += 1) {
    const out = run(fx, { shard: i, session: 's1' });
    if (!out) break;
    assert.ok(out.additionalContext.length < 10000, `shard ${i} too big: ${out.additionalContext.length}`);
  }
});

test('a real directory the user owns at the link path is left alone and the rules keep arriving as context', () => {
  const fx = fixture({ 'a.md': 'rule a' });
  fs.mkdirSync(fx.link, { recursive: true });
  fs.writeFileSync(path.join(fx.link, 'mine.md'), 'theirs');
  assert.match(run(fx, { session: 's1' }).additionalContext, /rule a/);
  assert.match(run(fx, { session: 's2' }).additionalContext, /rule a/);
  assert.ok(!fs.lstatSync(fx.link).isSymbolicLink());
  assert.strictEqual(fs.readFileSync(path.join(fx.link, 'mine.md'), 'utf8'), 'theirs');
});

test('without a data dir the hook does nothing', () => {
  const fx = fixture({ 'a.md': 'x' });
  assert.strictEqual(run(fx, { env: { CLAUDE_PLUGIN_DATA: '' } }), null);
  assert.ok(!fs.existsSync(path.dirname(fx.link)));
});

// Links published by other plugins through this same mechanism.
function published(fx, name, { withData = true } = {}) {
  const target = path.join(fx.home, '.claude', 'plugins', 'data', `${name}-mkt`, 'rules');
  if (withData) { fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'r.md'), 'r'); }
  fs.mkdirSync(path.dirname(fx.link), { recursive: true });
  const link = path.join(path.dirname(fx.link), name);
  fs.symlinkSync(target, link);
  return link;
}
const list = (entries) => JSON.stringify(entries.map(([id, enabled]) => ({ id, enabled })));

test('a link whose plugin was uninstalled (data dir gone) is removed', () => {
  const fx = fixture({});
  const gone = published(fx, 'gone', { withData: false });
  run(fx);
  assert.ok(!fs.readdirSync(path.dirname(gone)).includes('gone'));
});

test('a link whose plugin is disabled is removed; an enabled sibling stays', () => {
  const fx = fixture({});
  const off = published(fx, 'off');
  const on = published(fx, 'on');
  run(fx, { env: { FAKE_PLUGIN_LIST: list([['off@mkt', false], ['on@mkt', true]]) } });
  assert.ok(!fs.readdirSync(path.dirname(off)).includes('off'));
  assert.strictEqual(fs.readlinkSync(on), path.join(fx.home, '.claude', 'plugins', 'data', 'on-mkt', 'rules'));
});

test('when the plugin list cannot be read, only links with no data dir are removed', () => {
  const fx = fixture({});
  const kept = published(fx, 'kept');
  const gone = published(fx, 'gone', { withData: false });
  run(fx); // the stub exits 1 without FAKE_PLUGIN_LIST
  assert.ok(fs.readdirSync(path.dirname(kept)).includes('kept'));
  assert.ok(!fs.readdirSync(path.dirname(gone)).includes('gone'));
});

test('links that do not point into the plugin data dir are never touched', () => {
  const fx = fixture({});
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'link-rules-elsewhere-'));
  fs.mkdirSync(path.dirname(fx.link), { recursive: true });
  const mine = path.join(path.dirname(fx.link), 'mine');
  fs.symlinkSync(elsewhere, mine);
  run(fx, { env: { FAKE_PLUGIN_LIST: list([]) } });
  assert.strictEqual(fs.readlinkSync(mine), elsewhere);
});

test('a plugin with no rules of its own still sweeps', () => {
  const fx = fixture({});
  fs.rmSync(path.join(fx.root, 'rules'), { recursive: true });
  const off = published(fx, 'off');
  assert.strictEqual(run(fx, { env: { FAKE_PLUGIN_LIST: list([['off@mkt', false]]) } }), null);
  assert.ok(!fs.readdirSync(path.dirname(off)).includes('off'));
});

test('hooks.json registers the same shard slots for both events, and no injector', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, 'hooks.json'), 'utf8')).hooks;
  const commands = (event) =>
    hooks[event].flatMap((g) => g.hooks.map((h) => h.command)).filter((c) => c.includes('link-rules.cjs'));
  const session = commands('SessionStart');
  const subagent = commands('SubagentStart');
  assert.ok(session.length >= 2);
  assert.strictEqual(session.length, subagent.length, 'both events need the same number of shard slots');
  session.forEach((c, i) => assert.match(c, new RegExp(`link-rules\\.cjs" ${i}$`)));
  subagent.forEach((c, i) => assert.match(c, new RegExp(`link-rules\\.cjs" ${i} SubagentStart$`)));
  const all = Object.values(hooks).flat().flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(!all.some((c) => c.includes('inject-rules.cjs')));
});

test('the shipped rules publish as-is and fit the registered shard slots', () => {
  const fx = fixture({});
  fx.root = path.join(__dirname, '..');
  const slots = JSON.parse(fs.readFileSync(path.join(__dirname, 'hooks.json'), 'utf8')).hooks.SubagentStart.length;
  assert.ok(run(fx, { shard: 0, session: 's1' }), 'shard 0 of the publishing session carries rules');
  assert.strictEqual(run(fx, { shard: slots - 1, session: 's1' }), null,
    `rules now need every one of the ${slots} slots; add more before adding rules`);
  const shipped = fs.readdirSync(path.join(fx.root, 'rules')).filter((f) => f.endsWith('.md')).sort();
  assert.deepStrictEqual(fs.readdirSync(path.join(fx.home, '.claude', 'rules', 'dev-core')).sort(), shipped);
});

test('digest points at the published rules instead of replacing them', () => {
  const root = pluginRoot({ 'a.md': 'x' });
  fs.writeFileSync(path.join(root, 'rules-digest.md'), 'Lead with the result.');
  const out = execFileSync('node', [DIGEST_HOOK], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
    input: JSON.stringify({ prompt: 'hi', cwd: root }),
    encoding: 'utf8',
  });
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /^\[rules-reminder\]/);
  assert.match(ctx, /load from ~\/\.claude\/rules\//);
  assert.match(ctx, /not a replacement or a relaxation/);
  assert.match(ctx, /Lead with the result\./);
});

test('digest hook is silent when the digest file is absent', () => {
  const root = pluginRoot({ 'a.md': 'x' });
  const out = execFileSync('node', [DIGEST_HOOK], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
    input: JSON.stringify({ prompt: 'hi', cwd: root }),
    encoding: 'utf8',
  });
  assert.strictEqual(out.trim(), '');
});

test('the shipped digest stays small enough to repeat every message', () => {
  const digest = fs.readFileSync(path.join(__dirname, '..', 'rules-digest.md'), 'utf8');
  assert.ok(digest.length < 2000, `digest is ${digest.length} chars; keep it under 2000`);
});
