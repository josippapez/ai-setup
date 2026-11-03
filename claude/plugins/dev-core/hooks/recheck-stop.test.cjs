'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { decide } = require('./recheck-stop.cjs');

function transcript(records) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'recheck-')), 't.jsonl');
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

const prompt = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const toolUse = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } };
const toolResult = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } };
const answer = { type: 'assistant', message: { content: [{ type: 'text', text: 'It is a BE bug.' }] } };

const investigated = transcript([prompt('is 191770 a FE or BE bug?'), toolUse, toolResult, answer]);
const chatOnly = transcript([prompt('earlier'), toolUse, toolResult, answer, prompt('thanks'), answer]);

test('a medium turn that ran tools gets the recheck once', () => {
  const out = decide({ effort: { level: 'medium' }, transcript_path: investigated }, {});
  assert.match(out.hookSpecificOutput.additionalContext, /are you sure/);
  assert.equal(out.hookSpecificOutput.hookEventName, 'Stop');
});

test('the continuation after the recheck is let through', () => {
  assert.equal(decide({ effort: { level: 'medium' }, stop_hook_active: true, transcript_path: investigated }, {}), null);
});

test('high and above are left alone', () => {
  for (const level of ['high', 'xhigh', 'max']) {
    assert.equal(decide({ effort: { level }, transcript_path: investigated }, {}), null);
  }
});

test('a turn with no tool calls is left alone, even after earlier tool turns', () => {
  assert.equal(decide({ effort: { level: 'medium' }, transcript_path: chatOnly }, {}), null);
});

test('effort falls back to CLAUDE_EFFORT', () => {
  assert.ok(decide({ transcript_path: investigated }, { CLAUDE_EFFORT: 'low' }));
});

test('the script prints the JSON on stdin input', () => {
  const out = execFileSync('node', [path.join(__dirname, 'recheck-stop.cjs')], {
    input: JSON.stringify({ effort: { level: 'medium' }, transcript_path: investigated }),
  }).toString();
  assert.equal(JSON.parse(out).hookSpecificOutput.hookEventName, 'Stop');
});
