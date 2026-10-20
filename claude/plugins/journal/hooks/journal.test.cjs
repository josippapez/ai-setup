'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const script = path.join(__dirname, 'journal.cjs');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'a@b.c');
  git('config', 'user.name', 'a');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-data-'));
  // Its own sink config: a test must never hand entries to the real tracker.
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: data, JOURNAL_SINK_CONFIG: path.join(data, 'sink.json') };
  delete env.JOURNAL_DATA;
  const run = (mode, ev) => execFileSync('node', [script, mode], { input: JSON.stringify({ session_id: 's1', cwd: dir, ...ev }), env, encoding: 'utf8' });
  const write = (rel, text) => fs.writeFileSync(path.join(dir, rel), text);
  const rows = () => {
    const files = fs.existsSync(path.join(data, 'journal')) ? fs.readdirSync(path.join(data, 'journal')) : [];
    return files.length ? fs.readFileSync(path.join(data, 'journal', files[0]), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  };
  return { dir, data, git, run, write, rows };
}

test('a turn that changes files gets a journal row with line counts when there is no describer', () => {
  const r = repo();
  r.run('snapshot', { prompt: 'edit a' });
  r.write('a.txt', 'A\nB\n');
  r.write('package-lock.json', '{}\n');
  r.run('record', {});
  const [row] = r.rows();
  assert.equal(row.prompt, 'edit a');
  assert.deepEqual(row.files, [{ path: 'a.txt', what: 'changed (+2 -1)' }]);
});

test('the describer line is used when it has one', () => {
  const r = repo();
  fs.writeFileSync(path.join(r.data, 'describe'), '#!/bin/sh\ncat >/dev/null\nprintf "a.txt\\tadds a second line\\n"\n', { mode: 0o755 });
  r.run('snapshot', { prompt: 'x' });
  r.write('a.txt', 'a\nb\n');
  r.run('record', {});
  assert.deepEqual(r.rows()[0].files, [{ path: 'a.txt', what: 'adds a second line' }]);
});

test('a diff with no text lines never reaches the describer', () => {
  const r = repo();
  fs.writeFileSync(path.join(r.data, 'describe'), '#!/bin/sh\ncat >/dev/null\nprintf "bin.dat\\tinvented\\n"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(r.dir, 'bin.dat'), Buffer.from([0, 1, 2, 0]));
  r.git('add', '.');
  r.git('commit', '-qm', 'bin');
  r.run('snapshot', { prompt: 'x' });
  fs.writeFileSync(path.join(r.dir, 'bin.dat'), Buffer.from([0, 9, 9, 0]));
  r.run('record', {});
  assert.deepEqual(r.rows()[0].files, [{ path: 'bin.dat', what: 'changed (+0 -0)' }]);
});

test('a sensitive file never reaches the describer, and a symlink is hashed by its target text', () => {
  const r = repo();
  fs.writeFileSync(path.join(r.data, 'describe'), '#!/bin/sh\ncat > "$0.in"\nprintf ".env\\tSECRET=abc\\n"\n', { mode: 0o755 });
  const outside = path.join(r.data, 'outside.txt');
  fs.writeFileSync(outside, 'TOKEN=outside\n');
  r.run('snapshot', { prompt: 'x' });
  r.write('.env', 'SECRET=abc\n');
  fs.symlinkSync(outside, path.join(r.dir, 'link'));
  r.run('record', {});
  const files = r.rows()[0].files;
  assert.deepEqual(files.find(f => f.path === '.env'), { path: '.env', what: 'new: added (+1 -0)' });
  const sent = fs.readFileSync(path.join(r.data, 'describe.in'), 'utf8');
  assert.doesNotMatch(sent, /SECRET=abc|TOKEN=outside/);
});

test('a file name holding a newline never makes git hash a path outside the repo', () => {
  const r = repo();
  const outside = path.join(r.data, 'outside.txt');
  fs.writeFileSync(outside, 'TOKEN=outside\n');
  const { tree } = require('./journal.cjs');
  // A real file whose name, split at the newline, reads "x" and a path out of the repo.
  const evil = `x\n${path.relative(r.dir, outside)}`;
  fs.writeFileSync(path.join(r.dir, 'x'), 'x\n');
  fs.mkdirSync(path.dirname(path.join(r.dir, evil)), { recursive: true });
  fs.writeFileSync(path.join(r.dir, evil), 'y\n');
  tree(r.dir);
  // -w writes every hashed path into the repo's object store, so look there.
  const all = execFileSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: r.dir, encoding: 'utf8' });
  assert.doesNotMatch(all, /TOKEN=outside/);
});

test('a snapshot older than a day is swept at the next prompt', () => {
  const r = repo();
  fs.mkdirSync(path.join(r.data, 'sessions'), { recursive: true });
  const old = path.join(r.data, 'sessions', 'gone.json');
  fs.writeFileSync(old, '{}');
  const day = new Date(Date.now() - 25 * 3600 * 1000);
  fs.utimesSync(old, day, day);
  r.run('snapshot', { prompt: 'x' });
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(path.join(r.data, 'sessions', 's1.json')), true);
});

test('a turn that changes nothing writes no row, and earlier edits are not the turn\'s', () => {
  const r = repo();
  r.write('a.txt', 'user edit\n');
  r.run('snapshot', { prompt: 'x' });
  r.run('record', {});
  assert.deepEqual(r.rows(), []);
});

test('commits the turn made are found, a pulled or older commit is not', () => {
  const { turnCommits } = require('./journal.cjs');
  const r = repo();
  const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: r.dir, encoding: 'utf8' }).trim();
  const commitAs = (email, date) => execFileSync('git', ['-c', `user.email=${email}`, 'commit', '-qam', 'x'], { cwd: r.dir, env: { ...process.env, GIT_COMMITTER_DATE: date } });
  const before = { head: head(), ts: Date.now() };
  r.write('a.txt', '1\n');
  commitAs('someone@else', new Date().toISOString());
  r.write('a.txt', '2\n');
  commitAs('a@b.c', '2020-01-01T00:00:00Z');
  r.write('a.txt', '3\n');
  commitAs('a@b.c', new Date().toISOString());
  const mine = head().slice(0, 12);
  assert.deepEqual(turnCommits(before, { top: r.dir, head: head() }), [mine]);
});

test('a configured sink gets the entry, including a turn that only commits', () => {
  const r = repo();
  const got = path.join(r.data, 'got.jsonl');
  fs.writeFileSync(path.join(r.data, 'sink.sh'), `#!/bin/sh\ncat >> "${got}"\necho >> "${got}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(r.data, 'sink.json'), JSON.stringify({ command: [path.join(r.data, 'sink.sh')] }));
  r.run('snapshot', { prompt: 'edit a' });
  r.write('a.txt', 'A\n');
  r.run('record', {});
  r.write('a.txt', 'B\n');
  r.run('snapshot', { prompt: 'commit this' });
  r.git('commit', '-qam', 'user work');
  r.write('a.txt', 'C\n');
  r.git('commit', '-qam', 'turn work');
  r.run('record', {});
  const [edit, commit] = fs.readFileSync(got, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual({ ...edit, cwd: undefined, started: undefined }, { session_id: 's1', cwd: undefined, started: undefined, agent: 'claude-code', prompt: 'edit a', files: [{ path: 'a.txt', what: 'changed (+1 -1)' }] });
  // When the turn's prompt arrived, so a tracker can tell what the agent wrote during the turn.
  assert.ok(Date.parse(edit.started) <= Date.now() && Date.parse(commit.started) >= Date.parse(edit.started));
  assert.equal(fs.realpathSync(edit.cwd), fs.realpathSync(r.dir));
  assert.equal(commit.commits.length, 2);
  assert.equal(r.rows().length, 2);
});

test('no sink config, no sink, and the journal still writes', () => {
  const r = repo();
  r.run('snapshot', { prompt: 'x' });
  r.write('a.txt', 'A\n');
  r.run('record', {});
  assert.equal(r.rows().length, 1);
});

test('session start shows the last three rows, nothing when there are none', () => {
  const r = repo();
  assert.equal(r.run('inject', {}), '');
  for (const n of [1, 2, 3, 4]) {
    r.run('snapshot', { prompt: `turn ${n}` });
    r.write('a.txt', `v${n}\n`);
    r.run('record', {});
  }
  const ctx = JSON.parse(r.run('inject', {})).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /turn 1/);
  assert.match(ctx, /"turn 2"[\s\S]*"turn 3"[\s\S]*"turn 4"/);
  assert.match(ctx, /- a\.txt: changed \(\+1 -1\)/);
});
