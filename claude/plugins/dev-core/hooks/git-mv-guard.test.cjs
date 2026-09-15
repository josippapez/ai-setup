'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'git-mv-guard.cjs');

// A throwaway repo with one tracked file, one untracked file, one ignored file.
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-mv-guard-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@t.test');
  git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.txt\n');
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'ignored.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'a file.txt'), 'x');
  git('add', '.gitignore', 'tracked.txt', 'a file.txt');
  git('commit', '-qm', 'init');
  return dir;
}

// Returns the hookSpecificOutput, or null when the guard allowed the command.
function run(cwd, command, toolName = 'Bash') {
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: toolName, cwd, tool_input: { command } }),
    encoding: 'utf8',
  });
  return out.trim() ? JSON.parse(out).hookSpecificOutput : null;
}

test('denies a plain mv of a tracked file and names the git mv to run', () => {
  const dir = repo();
  const res = run(dir, 'mv tracked.txt moved.txt');
  assert.equal(res.permissionDecision, 'deny');
  assert.equal(res.hookEventName, 'PreToolUse');
  assert.match(res.permissionDecisionReason, /git mv tracked\.txt moved\.txt/);
});

test('quotes paths that need it in the suggested command', () => {
  const dir = repo();
  const res = run(dir, "mv 'a file.txt' 'b file.txt'");
  assert.match(res.permissionDecisionReason, /git mv 'a file\.txt' 'b file\.txt'/);
});

test('denies with a short flag present', () => {
  const dir = repo();
  assert.equal(run(dir, 'mv -f tracked.txt moved.txt').permissionDecision, 'deny');
});

test('allows untracked and ignored sources', () => {
  const dir = repo();
  assert.equal(run(dir, 'mv untracked.txt moved.txt'), null);
  assert.equal(run(dir, 'mv ignored.txt moved.txt'), null);
});

test('denies a plain mv buried in a compound command', () => {
  const dir = repo();
  // The shape the model actually produced when asked to rename a tracked file.
  const cmd = `mv tracked.txt moved.txt && sed -i '' "s|a|b|" other.js && echo done`;
  assert.equal(run(dir, cmd).permissionDecision, 'deny');
  assert.equal(run(dir, 'git status; mv tracked.txt moved.txt').permissionDecision, 'deny');
  assert.equal(run(dir, 'ls | head; mv tracked.txt moved.txt').permissionDecision, 'deny');
});

test('quotes containing separators do not split a segment', () => {
  const dir = repo();
  // The pipes belong to sed's own expression, so this is one segment and no mv at all.
  assert.equal(run(dir, `sed -i '' "s|tracked.txt|moved.txt|" other.js`), null);
});

test('allows anything it cannot parse with confidence', () => {
  const dir = repo();
  for (const cmd of [
    'mv tracked.txt other.txt moved/',
    'mv *.txt moved/',
    'mv $SRC moved.txt',
  ]) {
    assert.equal(run(dir, cmd), null, `should have allowed: ${cmd}`);
  }
});

test('allows outside a git work tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-mv-guard-nogit-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  assert.equal(run(dir, 'mv a.txt b.txt'), null);
});

test('allows temp paths and non-Bash tools', () => {
  const dir = repo();
  assert.equal(run(dir, 'mv /tmp/x.txt tracked.txt'), null);
  assert.equal(run(dir, 'mv tracked.txt moved.txt', 'Edit'), null);
});

test('malformed stdin emits nothing', () => {
  const out = execFileSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(out.trim(), '');
});
