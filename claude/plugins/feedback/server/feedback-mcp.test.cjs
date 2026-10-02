'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SERVER = path.join(__dirname, 'feedback-mcp.cjs');

// Sends a batch of JSON-RPC requests over stdio and returns the responses by id.
function rpc(dataDir, calls) {
  const input = calls
    .map((params, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params }))
    .join('\n');
  const out = execFileSync('node', [SERVER, dataDir], { input: `${input}\n` });
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
