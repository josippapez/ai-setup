'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parsePsRows, serversUnder, findSessionPid } = require('./reap-mcp-on-exit.cjs');

test('parsePsRows parses pid/ppid/command lines', () => {
  const rows = parsePsRows('  100 1 node a\n 200  100  node standalone-mcp.cjs\ngarbage\n');
  assert.deepStrictEqual(rows, [
    { pid: '100', ppid: '1', cmd: 'node a' },
    { pid: '200', ppid: '100', cmd: 'node standalone-mcp.cjs' },
  ]);
});

test('serversUnder selects ONLY standalone-mcp children of the given session pid', () => {
  const rows = [
    { pid: '201', ppid: '100', cmd: 'node /x/interactive-mcp/runtime/standalone-mcp.cjs' }, // mine
    { pid: '202', ppid: '100', cmd: 'node /x/markdown-orchestration/runtime/standalone-mcp.cjs' }, // mine
    { pid: '999', ppid: '777', cmd: 'node /x/interactive-mcp/runtime/standalone-mcp.cjs' }, // OTHER session — must NOT match
    { pid: '203', ppid: '100', cmd: 'node something-else.cjs' }, // not an mcp server
  ];
  assert.deepStrictEqual(serversUnder(rows, '100').sort(), ['201', '202']);
  assert.deepStrictEqual(serversUnder(rows, '777'), ['999']); // a different session's pid selects only its own
});

test('findSessionPid returns the nearest --session-id ancestor, honoring a known id', () => {
  // Ancestry: hook(ppid=10) → 10 (shell) → 20 (session, has --session-id SID) → 30 (bg-pty, also --session-id) → 1
  const cmd = { '10': '/bin/zsh', '20': 'claude --session-id SID-abc ...', '30': 'ClaudeCode bg-pty --session-id SID-abc', '1': 'launchd' };
  const par = { '10': '20', '20': '30', '30': '1' };
  const cmdOf = (p) => cmd[p] || '';
  const ppidOf = (p) => par[p] || '';
  assert.strictEqual(findSessionPid({ startPpid: '10', sessionId: 'SID-abc', cmdOf, ppidOf }), '20');
  // wrong id → no match even though ancestors carry --session-id
  assert.strictEqual(findSessionPid({ startPpid: '10', sessionId: 'OTHER', cmdOf, ppidOf }), null);
  // no id → nearest --session-id ancestor
  assert.strictEqual(findSessionPid({ startPpid: '10', sessionId: undefined, cmdOf, ppidOf }), '20');
});

test('findSessionPid returns null when no session ancestor is found', () => {
  const cmdOf = () => '/bin/zsh';
  const ppidOf = (p) => (p === '10' ? '11' : '1');
  assert.strictEqual(findSessionPid({ startPpid: '10', cmdOf, ppidOf }), null);
});
