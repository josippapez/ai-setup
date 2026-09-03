'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOOK = path.join(__dirname, 'enforce-doc-lookup.cjs');
const { injectSocketPath, statePath } = require('./lib/inject-client.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-doc-lookup-'));
}

// Stub server that always replies with the same used-status payload.
function startStub(root, reply) {
  const sock = injectSocketPath(root);
  fs.mkdirSync(path.dirname(sock), { recursive: true });
  try { fs.rmSync(sock, { force: true }); } catch {}
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (d) => {
      buf += d;
      if (buf.indexOf('\n') === -1) return;
      conn.end(JSON.stringify(reply) + '\n');
    });
    conn.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(sock, () => resolve(server)));
}

function runHook(input) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [HOOK]);
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', () => resolve(out));
    child.stdin.end(JSON.stringify(input));
  });
}

test('reminds once when no doc-lookup tool has been used yet this session', async () => {
  const root = tmpRoot();
  const server = await startStub(root, { docToolUsed: false });
  try {
    const event = { cwd: root, session_id: 'sess-1', hook_event_name: 'PreToolUse', tool_name: 'Grep' };
    const out = await runHook(event);
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.match(parsed.hookSpecificOutput.additionalContext, /find_docs/);
  } finally {
    server.close();
  }
});

test('stays silent once a doc-lookup tool has already been used this session', async () => {
  const root = tmpRoot();
  const server = await startStub(root, { docToolUsed: true });
  try {
    const event = { cwd: root, session_id: 'sess-2', hook_event_name: 'PreToolUse', tool_name: 'Grep' };
    const out = await runHook(event);
    assert.strictEqual(out, '');
  } finally {
    server.close();
  }
});

test('reminds at most once per session even if still unused on the next call', async () => {
  const root = tmpRoot();
  const server = await startStub(root, { docToolUsed: false });
  try {
    const event = { cwd: root, session_id: 'sess-3', hook_event_name: 'PreToolUse', tool_name: 'Grep' };
    const first = await runHook(event);
    assert.match(JSON.parse(first).hookSpecificOutput.additionalContext, /find_docs/);

    const second = await runHook(event);
    assert.strictEqual(second, '');
  } finally {
    server.close();
  }
});

test('silent when the socket is absent (server not running)', async () => {
  const root = tmpRoot();
  const event = { cwd: root, session_id: 'sess-4', hook_event_name: 'PreToolUse', tool_name: 'Grep' };
  const out = await runHook(event);
  assert.strictEqual(out, '');
});

test('never blocks the tool call — output carries no permissionDecision', async () => {
  const root = tmpRoot();
  const server = await startStub(root, { docToolUsed: false });
  try {
    const event = { cwd: root, session_id: 'sess-5', hook_event_name: 'PreToolUse', tool_name: 'Glob' };
    const out = await runHook(event);
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, undefined);
  } finally {
    server.close();
  }
});
