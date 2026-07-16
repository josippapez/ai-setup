'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOOK = path.join(__dirname, 'inject-on-prompt.cjs');
const { injectSocketPath } = require('./lib/inject-client.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inject-prompt-'));
}

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

// Run the hook as a child process (async so the in-process stub server can serve
// while the child connects — execFileSync would block the parent event loop).
function runHook(input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [HOOK], { ...(env ? { env } : {}) });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', () => resolve(out));
    child.stdin.end(JSON.stringify(input));
  });
}

test('prints additionalContext (UserPromptSubmit) when stub returns hits', async () => {
  const root = tmpRoot();
  const reply = { hits: [{ path: 'docs/x.md', startLine: 5, heading: 'H', snippet: 'sn', score: 0.8 }], injected: true };
  const server = await startStub(root, reply);
  try {
    const out = await runHook({ prompt: 'how do I configure the injection server', cwd: root });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(parsed.hookSpecificOutput.additionalContext, /docs\/x\.md:5/);
  } finally {
    server.close();
  }
});

test('silent (empty stdout) when the socket is absent', async () => {
  const root = tmpRoot();
  const out = await runHook({ prompt: 'how do I configure the injection server', cwd: root });
  assert.strictEqual(out, '');
});

test('silent for trivial prompt even with a live socket', async () => {
  const root = tmpRoot();
  const server = await startStub(root, { hits: [{ path: 'a', startLine: 1 }], injected: true });
  try {
    const out = await runHook({ prompt: 'hi', cwd: root });
    assert.strictEqual(out, '');
  } finally {
    server.close();
  }
});

test('silent for chit-chat filler even when the stub server would return hits', async () => {
  const root = tmpRoot();
  const server = await startStub(root, { hits: [{ path: 'docs/x.md', startLine: 5, heading: 'H', snippet: 'sn', score: 0.99 }], injected: true });
  try {
    const out = await runHook({ prompt: 'thanks that looks good', cwd: root });
    assert.strictEqual(out, '');
  } finally {
    server.close();
  }
});

test('uses default threshold 0.80 when no env override is set', async () => {
  const root = tmpRoot();
  let captured = null;
  const sock = injectSocketPath(root);
  fs.mkdirSync(path.dirname(sock), { recursive: true });
  try { fs.rmSync(sock, { force: true }); } catch {}
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      try { captured = JSON.parse(buf.slice(0, nl)); } catch {}
      conn.end(JSON.stringify({ hits: [], injected: false }) + '\n');
    });
    conn.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(sock, resolve));
  try {
    const cleanEnv = { ...process.env };
    delete cleanEnv.REPO_DOCS_INJECT_THRESHOLD;
    delete cleanEnv.REPO_DOCS_INJECT_THRESHOLD_PROGRESS;
    await runHook({ prompt: 'how does auth work in this repo', cwd: root }, cleanEnv);
    assert.ok(captured, 'expected the hook to reach the stub server');
    assert.strictEqual(captured.threshold, 0.80);
  } finally {
    server.close();
  }
});
