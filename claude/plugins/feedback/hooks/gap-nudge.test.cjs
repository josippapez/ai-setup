'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { lastTurn, score } = require('./gap-nudge.cjs');
const MODEL = require('./gap-model.json');

const line = entry => JSON.stringify(entry);
const prompt = text => line({ type: 'user', message: { content: text } });
const said = text => line({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const called = name => line({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input: {} }] } });
const toolResult = line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } });

test('lastTurn returns the final text of the previous turn', () => {
  const lines = [prompt('first'), said('old answer'), prompt('second'), said('working'), toolResult, said('final answer')];
  assert.deepStrictEqual(lastTurn(lines), { text: 'final answer', logged: false });
});

test('lastTurn skips the prompt being submitted when it is already in the transcript', () => {
  const lines = [prompt('first'), said('the answer'), prompt('next')];
  assert.deepStrictEqual(lastTurn(lines), { text: 'the answer', logged: false });
});

test('lastTurn sees a collect_feedback call in the previous turn', () => {
  const lines = [prompt('first'), called('mcp__plugin_feedback_feedback__collect_feedback'), toolResult, said('logged it')];
  assert.deepStrictEqual(lastTurn(lines), { text: 'logged it', logged: true });
});

test('lastTurn ignores a feedback call from an earlier turn', () => {
  const lines = [prompt('a'), called('mcp__plugin_feedback_feedback__collect_feedback'), said('x'), prompt('b'), said('y')];
  assert.deepStrictEqual(lastTurn(lines), { text: 'y', logged: false });
});

test('score is the bias plus the weighted sum', () => {
  const unit = MODEL.weights.map((_, i) => (i === 0 ? 1 : 0));
  assert.strictEqual(score(unit), MODEL.bias + MODEL.weights[0]);
});
