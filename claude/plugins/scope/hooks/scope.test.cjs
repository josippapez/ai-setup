'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const script = path.join(__dirname, 'scope.cjs');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'a@b.c');
  git('config', 'user.name', 'a');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/b.txt'), 'b\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-data-'));
  const run = (mode, ev) => execFileSync('node', [script, mode], {
    input: JSON.stringify({ session_id: 's1', cwd: dir, ...ev }),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: data },
    encoding: 'utf8',
  });
  const write = (rel, text) => fs.writeFileSync(path.join(dir, rel), text);
  return { dir, git, run, write };
}

test('a changed file the answer does not name blocks once', () => {
  const r = repo();
  r.run('snapshot', { prompt: 'fix a' });
  r.write('a.txt', 'A\n');
  r.write('src/b.txt', 'B\n');
  const out = JSON.parse(r.run('check', { last_assistant_message: 'Changed a.txt.', stop_hook_active: false }));
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /src\/b\.txt/);
  assert.doesNotMatch(out.reason, /a\.txt/);
  // The snapshot is spent: the continued turn passes.
  r.run('snapshot', { prompt: 'x' });
  assert.equal(r.run('check', { last_assistant_message: '', stop_hook_active: true }), '');
});

test('a file named in the prompt, by basename, or by directory passes', () => {
  const r = repo();
  r.run('snapshot', { prompt: 'edit src/b.txt' });
  r.write('a.txt', 'A\n');
  r.write('src/b.txt', 'B\n');
  r.write('c.txt', 'new\n');
  const out = r.run('check', { last_assistant_message: 'Updated a.txt and added c.txt.', stop_hook_active: false });
  assert.equal(out, '');
  const r2 = repo();
  r2.run('snapshot', { prompt: 'x' });
  r2.write('src/b.txt', 'B\n');
  assert.equal(r2.run('check', { last_assistant_message: 'Edited the src/ files.', stop_hook_active: false }), '');
});

test('changes already in the tree before the prompt are not the turn\'s', () => {
  const r = repo();
  r.write('a.txt', 'user edit\n');
  r.run('snapshot', { prompt: 'x' });
  assert.equal(r.run('check', { last_assistant_message: 'Nothing changed.', stop_hook_active: false }), '');
});

test('a file changed and committed during the turn still counts', () => {
  const r = repo();
  r.run('snapshot', { prompt: 'x' });
  r.write('src/b.txt', 'B\n');
  r.git('commit', '-qam', 'ride along');
  const out = JSON.parse(r.run('check', { last_assistant_message: 'Done.', stop_hook_active: false }));
  assert.match(out.reason, /src\/b\.txt/);
});

test('committing what was already in the tree is not a change', () => {
  const r = repo();
  r.write('a.txt', 'user edit\n');
  r.write('c.txt', 'user file\n');
  r.run('snapshot', { prompt: 'commit this' });
  r.git('add', '.');
  r.git('commit', '-qm', 'user work');
  assert.equal(r.run('check', { last_assistant_message: 'Committed as 1234567.', stop_hook_active: false }), '');
});

test('a prompt sent mid-turn keeps the snapshot', () => {
  const r = repo();
  r.run('snapshot', { prompt: 'x' });
  r.write('a.txt', 'A\n');
  r.run('snapshot', { prompt: 'also y' });
  const out = JSON.parse(r.run('check', { last_assistant_message: 'Done.', stop_hook_active: false }));
  assert.match(out.reason, /a\.txt/);
});

test('outside a git repo nothing happens', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-nogit-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-data-'));
  const run = (mode, ev) => execFileSync('node', [script, mode], {
    input: JSON.stringify({ session_id: 's1', cwd: dir, ...ev }),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: data },
    encoding: 'utf8',
  });
  run('snapshot', { prompt: 'x' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'A\n');
  assert.equal(run('check', { last_assistant_message: 'Done.', stop_hook_active: false }), '');
});
