'use strict';

const assert = require('node:assert');
const { test } = require('node:test');
const { formatBlock, injectSocketPath, isConversationalFiller } = require('./inject-client.cjs');

test('uses the OpenCode repository-docs socket', () => {
  assert.ok(injectSocketPath('/repo').endsWith('/repo/.opencode/repo-docs/inject.sock'));
});

test('skips conversational filler but keeps substantive prompts', () => {
  assert.strictEqual(isConversationalFiller('thanks!'), true);
  assert.strictEqual(isConversationalFiller('How does authentication work?'), false);
});

test('formats namespaced repository-doc references', () => {
  const block = formatBlock([{ path: 'docs/auth.md', startLine: 7, heading: 'Tokens', snippet: 'Refresh tokens.' }]);
  assert.match(block, /interactive-mcp-standalone_read_doc/);
  assert.match(block, /docs\/auth\.md:7 > Tokens/);
});
