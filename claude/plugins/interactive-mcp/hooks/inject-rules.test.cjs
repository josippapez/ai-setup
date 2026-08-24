'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'inject-rules.cjs');
const DIGEST_HOOK = path.join(__dirname, 'inject-rules-digest.cjs');

function pluginRoot(rules) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-rules-'));
  fs.mkdirSync(path.join(root, 'rules'));
  for (const [name, body] of Object.entries(rules)) {
    fs.writeFileSync(path.join(root, 'rules', name), body);
  }
  return root;
}

function runShard(root, shard) {
  const out = execFileSync('node', [HOOK, String(shard)], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
    encoding: 'utf8',
  });
  if (!out.trim()) return null;
  return JSON.parse(out).hookSpecificOutput.additionalContext;
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
