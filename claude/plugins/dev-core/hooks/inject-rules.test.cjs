'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'inject-rules.cjs');
const DIGEST_HOOK = path.join(__dirname, 'inject-rules-digest.cjs');

function pluginRoot(rules, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-rules-'));
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

function runShard(root, shard, event) {
  const args = event === undefined ? [HOOK, String(shard)] : [HOOK, String(shard), event];
  const out = execFileSync('node', args, {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
    encoding: 'utf8',
  });
  if (!out.trim()) return null;
  return JSON.parse(out).hookSpecificOutput.additionalContext;
}

function runShardRaw(root, shard, event) {
  const args = event === undefined ? [HOOK, String(shard)] : [HOOK, String(shard), event];
  const out = execFileSync('node', args, {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
    encoding: 'utf8',
  });
  return out.trim() ? JSON.parse(out).hookSpecificOutput : null;
}

function allShards(root, slots = 8) {
  const out = [];
  for (let i = 0; i < slots; i += 1) {
    const c = runShard(root, i);
    if (c === null) break;
    out.push(c);
  }
  return out;
}

test('every shard stays under the 10,000-character additionalContext cap', () => {
  const root = pluginRoot({
    'a.md': 'A'.repeat(8000),
    'b.md': 'B'.repeat(8000),
    'c.md': 'C'.repeat(8000),
  });
  for (const shard of allShards(root)) assert.ok(shard.length < 10000, `shard too big: ${shard.length}`);
});

test('no rule is dropped or duplicated across shards', () => {
  const root = pluginRoot({
    'a.md': 'A'.repeat(5000),
    'b.md': 'B'.repeat(5000),
    'c.md': 'C'.repeat(5000),
    'd.md': 'small',
  });
  const joined = allShards(root).join('\n');
  for (const name of ['a.md', 'b.md', 'c.md', 'd.md']) {
    const hits = joined.split(`<!-- ${name} -->`).length - 1;
    assert.strictEqual(hits, 1, `${name} appeared ${hits} times`);
  }
});

test('small rule sets still fit in one shard', () => {
  const root = pluginRoot({ 'a.md': 'short', 'b.md': 'also short' });
  assert.strictEqual(allShards(root).length, 1);
});

test('spare shard slots emit nothing rather than failing', () => {
  const root = pluginRoot({ 'a.md': 'short' });
  assert.strictEqual(runShard(root, 5), null);
});

test('a single rule larger than the cap gets its own shard rather than being split', () => {
  const root = pluginRoot({ 'big.md': 'X'.repeat(12000), 'small.md': 'y' });
  const shards = allShards(root);
  assert.strictEqual(shards.length, 2);
  assert.ok(shards[0].includes('<!-- big.md -->'));
  assert.ok(shards[1].includes('<!-- small.md -->'));
});

test('shard 0 says how many parts follow', () => {
  const root = pluginRoot({ 'a.md': 'A'.repeat(8000), 'b.md': 'B'.repeat(8000) });
  assert.match(runShard(root, 0), /Delivered in 2 parts/);
  assert.match(runShard(root, 1), /part 2 of 2/);
});

test('missing rules dir is silent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-rules-empty-'));
  assert.strictEqual(runShard(root, 0), null);
});

test('digest points at the full rules instead of replacing them', () => {
  const root = pluginRoot({ 'a.md': 'x' });
  fs.writeFileSync(path.join(root, 'rules-digest.md'), 'Lead with the result.');
  const out = execFileSync('node', [DIGEST_HOOK], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
    input: JSON.stringify({ prompt: 'hi', cwd: root }),
    encoding: 'utf8',
  });
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /^\[rules-reminder\]/);
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

test('the header names the plugin from its own manifest, so the hook can be copied between plugins', () => {
  const root = pluginRoot({ 'a.md': 'A'.repeat(100), 'b.md': 'B'.repeat(100) }, 'concise-output');
  const [first] = allShards(root);
  assert.match(first, /bundled with the concise-output plugin/);
});

test('a plugin with no manifest falls back to its directory name instead of failing', () => {
  const root = pluginRoot({ 'a.md': 'A'.repeat(100) });
  const [first] = allShards(root);
  assert.match(first, new RegExp(`bundled with the ${path.basename(root)} plugin`));
});

test('the reply labels itself with the event that fired, so Claude Code keeps the value', () => {
  const root = pluginRoot({ 'a.md': 'x' });
  assert.strictEqual(runShardRaw(root, 0, 'SessionStart').hookEventName, 'SessionStart');
  assert.strictEqual(runShardRaw(root, 0, 'SubagentStart').hookEventName, 'SubagentStart');
});

test('the event argument defaults to SessionStart', () => {
  const root = pluginRoot({ 'a.md': 'x' });
  assert.strictEqual(runShardRaw(root, 0).hookEventName, 'SessionStart');
});

test('an unrecognised event name emits nothing rather than a wrongly-labelled value', () => {
  const root = pluginRoot({ 'a.md': 'x' });
  assert.strictEqual(runShard(root, 0, 'PostToolUse'), null);
  assert.strictEqual(runShard(root, 0, 'sessionstart'), null);
});

test('a subagent is told the rules apply to its task, not to a session it cannot see', () => {
  const root = pluginRoot({ 'a.md': 'x' });
  assert.match(runShard(root, 0, 'SubagentStart'), /they apply to this task/);
  assert.match(runShard(root, 0, 'SessionStart'), /they apply to every session/);
});

test('every shard stays under the cap for SubagentStart too', () => {
  const root = pluginRoot({ 'a.md': 'A'.repeat(8000), 'b.md': 'B'.repeat(8000) });
  for (let i = 0; i < 8; i += 1) {
    const c = runShard(root, i, 'SubagentStart');
    if (c === null) break;
    assert.ok(c.length < 10000, `shard ${i} too big: ${c.length}`);
  }
});

test('hooks.json registers the rules for both audiences, with equal shard capacity', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, 'hooks.json'), 'utf8')).hooks;
  const commands = (event) => hooks[event].flatMap((g) => g.hooks.map((h) => h.command));
  const session = commands('SessionStart');
  const subagent = commands('SubagentStart');
  assert.strictEqual(session.length, subagent.length, 'both events need the same number of shard slots');
  session.forEach((c, i) => assert.match(c, new RegExp(`inject-rules\\.cjs" ${i}$`)));
  subagent.forEach((c, i) => assert.match(c, new RegExp(`inject-rules\\.cjs" ${i} SubagentStart$`)));
});

test('the shipped rules fit the registered shard slots', () => {
  const root = path.join(__dirname, '..');
  const slots = JSON.parse(fs.readFileSync(path.join(__dirname, 'hooks.json'), 'utf8'))
    .hooks.SessionStart.length;
  assert.strictEqual(runShard(root, slots - 1, 'SessionStart'), null,
    `rules now need every one of the ${slots} slots; add more before adding rules`);
});
