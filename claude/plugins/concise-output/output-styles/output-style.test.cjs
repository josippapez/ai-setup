'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const STYLE = path.join(__dirname, 'concise-output.md');
const PLUGIN = path.join(__dirname, '..');

function frontmatter(body) {
  const m = body.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, 'style file must open with YAML frontmatter');
  return Object.fromEntries(
    m[1].split(/\r?\n/).filter(Boolean).map((line) => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
}

test('style keeps the built-in coding instructions and applies with the plugin', () => {
  const fm = frontmatter(fs.readFileSync(STYLE, 'utf8'));
  assert.strictEqual(fm.name, 'concise-output');
  assert.ok(fm.description, 'description shows in the /config picker');
  // Without this, Claude Code drops its own software engineering instructions.
  assert.strictEqual(fm['keep-coding-instructions'], 'true');
  assert.strictEqual(fm['force-for-plugin'], 'true');
});

test('the rules the style replaced are no longer double-injected as rules/', () => {
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'rules')), 'rules/ moved into the output style');
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'hooks', 'inject-rules.cjs')), 'SessionStart rule injection removed');
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.deepStrictEqual(Object.keys(hooks).sort(), ['SessionStart', 'UserPromptSubmit'],
    'the per-prompt digest, plus the compact-only exemplars');
  const cmds = JSON.stringify(hooks.SessionStart);
  assert.match(cmds, /inject-post-compact-exemplars\.cjs/);
  assert.doesNotMatch(cmds, /inject-rules\.cjs/, 'rules injection is the output style\'s job now');
});

test('the exemplar hook speaks only after a compaction', () => {
  const hook = path.join(PLUGIN, 'hooks', 'inject-post-compact-exemplars.cjs');
  const run = (source) => execFileSync('node', [hook], { input: JSON.stringify({ source }), encoding: 'utf8' });
  assert.strictEqual(run('startup').trim(), '', 'silent on a normal session start');
  assert.strictEqual(run('resume').trim(), '', 'silent on resume');
  const ctx = JSON.parse(run('compact')).hookSpecificOutput.additionalContext;
  assert.match(ctx, /^\[length-calibration\]/);
  // Specimens, not a restatement of the rules: short Q/A pairs the model can measure against.
  assert.ok(ctx.split('\nQ: ').length - 1 >= 3, 'carries at least three specimen answers');
  assert.ok(ctx.length < 2000, `exemplars are ${ctx.length} chars; keep them small`);
});

test('style carries the substance of both former rules', () => {
  const body = fs.readFileSync(STYLE, 'utf8');
  for (const marker of [
    'Answer the question. Stop.',        // concise-output
    'Exempt: agent-to-agent traffic',    // the exemption subagents rely on
    'Outbound content',                  // former outbound-content rule
    'Not a licence to under-deliver',    // the anti-under-delivery guard
  ]) assert.ok(body.includes(marker), marker);
});

test('the digest reminder describes where the full rules actually live', () => {
  const digestHook = fs.readFileSync(path.join(PLUGIN, 'hooks', 'inject-rules-digest.cjs'), 'utf8');
  assert.match(digestHook, /output-styles/, 'hook detects the output-style mechanism');
  assert.match(digestHook, /active output style/);
});
