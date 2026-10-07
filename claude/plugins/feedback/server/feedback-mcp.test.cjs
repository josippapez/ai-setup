'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SERVER = path.join(__dirname, 'feedback-mcp.cjs');

// Sends a batch of JSON-RPC requests over stdio and returns the responses by id.
function rpc(dataDir, calls, cwd) {
  const input = calls
    .map((params, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params }))
    .join('\n');
  const out = execFileSync('node', [SERVER, dataDir], { input: `${input}\n`, cwd });
  return out.toString().trim().split('\n').map((l) => JSON.parse(l));
}

test('collect_feedback appends an entry that read_feedback returns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-'));
  const [collected] = rpc(dir, [
    {
      name: 'collect_feedback',
      arguments: { kind: 'ambiguity', title: 'Two rules disagree', details: 'X says A, Y says B', area: 'dev-core' },
    },
  ]);
  assert.match(collected.result.content[0].text, /Recorded feedback \w{8}: \[ambiguity\/medium\] Two rules disagree/);

  const [read] = rpc(dir, [{ name: 'read_feedback', arguments: { area: 'DEV' } }]);
  assert.match(read.result.content[0].text, /1 of 1 entries match/);
  assert.match(read.result.content[0].text, /X says A, Y says B/);

  const lines = fs.readFileSync(path.join(dir, 'feedback.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
});

test('read_feedback filters by kind and lists newest first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-'));
  rpc(dir, [
    { name: 'collect_feedback', arguments: { kind: 'bug', title: 'first bug', details: 'd' } },
    { name: 'collect_feedback', arguments: { kind: 'idea', title: 'an idea', details: 'd' } },
    { name: 'collect_feedback', arguments: { kind: 'bug', title: 'second bug', details: 'd' } },
  ]);
  const [read] = rpc(dir, [{ name: 'read_feedback', arguments: { kind: 'bug' } }]);
  const text = read.result.content[0].text;
  assert.match(text, /2 of 3 entries match/);
  assert.ok(text.indexOf('second bug') < text.indexOf('first bug'));
  assert.doesNotMatch(text, /an idea/);
});

test('collect_feedback rejects a missing title and an unknown kind', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-'));
  const [noTitle, badKind] = rpc(dir, [
    { name: 'collect_feedback', arguments: { kind: 'bug', details: 'd' } },
    { name: 'collect_feedback', arguments: { kind: 'nope', title: 't', details: 'd' } },
  ]);
  assert.strictEqual(noTitle.result.isError, true);
  assert.strictEqual(badKind.result.isError, true);
  assert.ok(!fs.existsSync(path.join(dir, 'feedback.jsonl')));
});

test('update_feedback resolves an entry, which read_feedback then hides unless asked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-'));
  const [made] = rpc(dir, [{ name: 'collect_feedback', arguments: { kind: 'bug', title: 'leaks tmp files', details: 'd' } }]);
  const id = made.result.content[0].text.match(/Recorded feedback (\w{8})/)[1];

  const [updated] = rpc(dir, [{ name: 'update_feedback', arguments: { id, status: 'resolved', resolution: 'sweep on lock', severity: 'low' } }]);
  assert.match(updated.result.content[0].text, new RegExp(`Updated feedback ${id}: \\[bug/low/resolved\\] leaks tmp files`));

  const [open, resolved] = rpc(dir, [
    { name: 'read_feedback', arguments: {} },
    { name: 'read_feedback', arguments: { status: 'resolved' } },
  ]);
  assert.match(open.result.content[0].text, /No feedback matches \(1 total/);
  assert.match(resolved.result.content[0].text, /Resolution \(.+\): sweep on lock/);

  const [reopened] = rpc(dir, [{ name: 'update_feedback', arguments: { id, status: 'open' } }]);
  assert.match(reopened.result.content[0].text, /\/open\]/);
  const lines = fs.readFileSync(path.join(dir, 'feedback.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 3, 'updates are appended, never rewritten');
});

test('update_feedback rejects an unknown id and an update with no fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-'));
  const [made] = rpc(dir, [{ name: 'collect_feedback', arguments: { kind: 'idea', title: 't', details: 'd' } }]);
  const id = made.result.content[0].text.match(/Recorded feedback (\w{8})/)[1];
  const [unknown, empty] = rpc(dir, [
    { name: 'update_feedback', arguments: { id: 'nope1234', status: 'resolved' } },
    { name: 'update_feedback', arguments: { id } },
  ]);
  assert.strictEqual(unknown.result.isError, true);
  assert.strictEqual(empty.result.isError, true);
});

test('read_feedback shows only this project unless project is "all"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-'));
  const here = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'project-')));
  const entry = (id, cwd) => JSON.stringify({ id, createdAt: '2026-10-07T00:00:00.000Z', kind: 'bug', severity: 'low', title: `t-${id}`, details: 'd', cwd });
  fs.writeFileSync(path.join(dir, 'feedback.jsonl'), [entry('here0001', here), entry('sub00001', `${here}/pkg`), entry('else0001', '/somewhere/else')].join('\n') + '\n');

  const [current] = rpc(dir, [{ name: 'read_feedback', arguments: {} }], here);
  assert.match(current.result.content[0].text, /2 of 2 entries match/);
  assert.match(current.result.content[0].text, /1 more in other projects/);
  assert.doesNotMatch(current.result.content[0].text, /t-else0001/);

  const [all] = rpc(dir, [{ name: 'read_feedback', arguments: { project: 'all' } }], here);
  assert.match(all.result.content[0].text, /3 of 3 entries match/);
  assert.match(all.result.content[0].text, /t-else0001/);
});
