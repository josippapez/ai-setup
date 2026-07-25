'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { test } = require('node:test');
const {
  formatBlock,
  injectSocketPath,
  isConversationalFiller,
  queryInjectWithRetry,
} = require('./inject-client.cjs');

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

test('retries while the injection socket starts', async () => {
  const root = fs.mkdtempSync(path.join('/tmp', 'ocinj-'));
  const socketPath = injectSocketPath(root);
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  const server = net.createServer((connection) => {
    connection.on('data', () => connection.end(`${JSON.stringify({ injected: true, hits: [{ path: 'README.md' }] })}\n`));
  });
  const start = setTimeout(() => server.listen(socketPath), 75);

  const result = await queryInjectWithRetry(root, { query: 'setup' }, {
    attempts: 5,
    delayMs: 50,
    timeoutMs: 100,
  });

  clearTimeout(start);
  assert.strictEqual(result.injected, true);
  await new Promise((resolve) => server.close(resolve));
});
