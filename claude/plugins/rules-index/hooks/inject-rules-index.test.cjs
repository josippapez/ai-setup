'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'inject-rules-index.cjs');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'rules-index-')); }
function write(root, rel, body) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
// Run the hook as Claude Code would: event JSON on stdin, HOME pointed at a temp
// dir so the machine's real ~/.claude/rules never leaks into a test.
function run(cwd, home, source = 'startup') {
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ cwd, hook_event_name: 'SessionStart', source, session_id: 't' }),
    env: { ...process.env, HOME: home },
  }).toString();
  return out ? JSON.parse(out).hookSpecificOutput : null;
}

test('silent when neither the project nor the user has a rules directory', () => {
  const cwd = tmp(), home = tmp();
  assert.strictEqual(run(cwd, home), null);
});

test('always-on rule shows its description; path-scoped rule shows name, description, and globs', () => {
  const cwd = tmp(), home = tmp();
  write(cwd, '.claude/rules/code-comments.md', '---\nname: code-comments\ndescription: Comment why, never what.\n---\n# Code comments\n');
  write(cwd, '.claude/rules/web-conventions.md', "---\ndescription: 'Web app conventions.'\npaths:\n  - 'apps/HCP-Portal/**'\n  - \"libs/web/**\"\n---\n# Web\n");
  const out = run(cwd, home);
  assert.strictEqual(out.hookEventName, 'SessionStart');
  const ctx = out.additionalContext;
  assert.match(ctx, /^\[rules-index\]/);
  assert.match(ctx, /Always on/);
  assert.match(ctx, /\.claude\/rules\/code-comments\.md — code-comments: Comment why, never what\./);
  assert.match(ctx, /Path-scoped/);
  assert.match(ctx, /\.claude\/rules\/web-conventions\.md — Web app conventions\. \(paths: apps\/HCP-Portal\/\*\*, libs\/web\/\*\*\)/);
  // ordering: always-on section before path-scoped section
  assert.ok(ctx.indexOf('Always on') < ctx.indexOf('Path-scoped'));
});

test('falls back to the filename when there is no frontmatter, reads inline paths arrays, recurses into subdirectories', () => {
  const cwd = tmp(), home = tmp();
  write(cwd, '.claude/rules/never-read-env.md', 'Never read .env files.\n');
  write(cwd, '.claude/rules/frontend/perf.md', '---\npaths: ["apps/**/*.tsx", "libs/**/*.tsx"]\n---\nPerf rules\n');
  const ctx = run(cwd, home).additionalContext;
  assert.match(ctx, /^- \.claude\/rules\/never-read-env\.md$/m);
  assert.match(ctx, /\.claude\/rules\/frontend\/perf\.md \(paths: apps\/\*\*\/\*\.tsx, libs\/\*\*\/\*\.tsx\)/);
});

test('user-level rules under ~/.claude/rules are listed with a ~ path', () => {
  const cwd = tmp(), home = tmp();
  write(home, '.claude/rules/preferences.md', '---\ndescription: Personal preferences.\n---\n');
  const ctx = run(cwd, home).additionalContext;
  assert.match(ctx, /~\/\.claude\/rules\/preferences\.md — Personal preferences\./);
});

test('stays under the 10,000-character hook output cap and says how many rules were left out', () => {
  const cwd = tmp(), home = tmp();
  for (let i = 0; i < 300; i++) {
    write(cwd, `.claude/rules/rule-${String(i).padStart(3, '0')}.md`, `---\ndescription: ${'x'.repeat(60)} ${i}\n---\n`);
  }
  const ctx = run(cwd, home).additionalContext;
  assert.ok(ctx.length < 10000, `length ${ctx.length}`);
  assert.match(ctx, /\+\d+ more rule/);
});

test('rules-index has a valid plugin manifest and a SessionStart-only hooks.json', () => {
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.strictEqual(manifest.name, 'rules-index');
  const hooks = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.deepStrictEqual(Object.keys(hooks), ['SessionStart']);
  assert.ok(hooks.SessionStart[0].hooks[0].command.includes('inject-rules-index.cjs'));
});
