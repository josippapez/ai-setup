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
  const commit = (msg) => { git('add', '.'); git('commit', '-qm', msg); };
  const note = (answer) => run('check', { last_assistant_message: answer, stop_hook_active: false });
  return { dir, git, run, write, commit, note };
}

test('a changed file the answer does not name is noted, not blocked', () => {
  const r = repo();
  r.run('snapshot', { prompt: 'fix a' });
  r.write('a.txt', 'A\n');
  r.write('src/b.txt', 'B\n');
  const out = JSON.parse(r.note('Changed a.txt.'));
  assert.equal(out.decision, undefined);
  assert.equal(out.systemMessage, 'scope: changed but not named: src/b.txt');
});

test('a file named in the prompt, by basename, or by directory passes', () => {
  const r = repo();
  r.run('snapshot', { prompt: 'edit src/b.txt' });
  r.write('a.txt', 'A\n');
  r.write('src/b.txt', 'B\n');
  r.write('c.txt', 'new\n');
  assert.equal(r.note('Updated a.txt and added c.txt.'), '');
  const r2 = repo();
  r2.run('snapshot', { prompt: 'x' });
  r2.write('src/b.txt', 'B\n');
  assert.equal(r2.note('Edited the src/ files.'), '');
});

test('naming a sibling by full path does not name the file', () => {
  const r = repo();
  r.write('src/c.txt', 'c\n');
  r.commit('c');
  r.run('snapshot', { prompt: 'x' });
  r.write('src/b.txt', 'B\n');
  r.write('src/c.txt', 'C\n');
  assert.equal(JSON.parse(r.note('Changed src/c.txt.')).systemMessage, 'scope: changed but not named: src/b.txt');
});

test('changes already in the tree before the prompt are not the turn\'s', () => {
  const r = repo();
  r.write('a.txt', 'user edit\n');
  r.run('snapshot', { prompt: 'x' });
  assert.equal(r.note('Nothing changed.'), '');
});

test('a file changed and committed during the turn still counts', () => {
  const r = repo();
  r.run('snapshot', { prompt: 'x' });
  r.write('src/b.txt', 'B\n');
  r.commit('ride along');
  assert.match(JSON.parse(r.note('Done.')).systemMessage, /src\/b\.txt/);
});

test('committing what was already in the tree is not a change', () => {
  const r = repo();
  r.write('a.txt', 'user edit\n');
  r.write('c.txt', 'user file\n');
  r.run('snapshot', { prompt: 'commit this' });
  r.commit('user work');
  assert.equal(r.note('Committed as 1234567.'), '');
});

test('a prompt sent mid-turn keeps the snapshot', () => {
  const r = repo();
  r.run('snapshot', { prompt: 'x' });
  r.write('a.txt', 'A\n');
  r.run('snapshot', { prompt: 'also y' });
  assert.match(JSON.parse(r.note('Done.')).systemMessage, /a\.txt/);
});

test('lockfiles are never noted', () => {
  const r = repo();
  r.write('package-lock.json', '{"v":1}\n');
  r.write('src/Cargo.lock', 'x\n');
  r.commit('locks');
  r.run('snapshot', { prompt: 'x' });
  r.write('package-lock.json', '{"v":2}\n');
  r.write('src/Cargo.lock', 'y\n');
  assert.equal(r.note('Done.'), '');
});

test('a diff that only changes version numbers is not noted, one that changes more is', () => {
  const r = repo();
  r.write('package.json', '{\n  "name": "x",\n  "version": "1.2.3"\n}\n');
  r.write('tauri.conf.json', '{\n  "version": "1.2.3",\n  "title": "x"\n}\n');
  r.commit('v1.2.3');
  r.run('snapshot', { prompt: 'cut a release' });
  r.write('package.json', '{\n  "name": "x",\n  "version": "1.2.4"\n}\n');
  r.write('tauri.conf.json', '{\n  "version": "1.2.4",\n  "title": "y"\n}\n');
  assert.equal(JSON.parse(r.note('Bumped to 1.2.4.')).systemMessage, 'scope: changed but not named: tauri.conf.json');
});

test('reordered lines or a version with extra text are not taken for a bump', () => {
  const r = repo();
  r.write('app.cfg', 'api=1.0.0\ndb=2.0.0\n');
  r.write('b.cfg', 'version=1.2.3\n');
  r.commit('v1.2.3');
  r.run('snapshot', { prompt: 'cut a release' });
  r.write('app.cfg', 'db=2.0.1\napi=1.0.1\n');
  r.write('b.cfg', 'version=1.2.4evil\n');
  assert.equal(JSON.parse(r.note('Bumped.')).systemMessage, 'scope: changed but not named: app.cfg, b.cfg');
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
