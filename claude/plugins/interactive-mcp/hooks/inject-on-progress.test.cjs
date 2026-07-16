'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOOK = path.join(__dirname, 'inject-on-progress.cjs');
const { injectSocketPath } = require('./lib/inject-client.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inject-progress-'));
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

function writeTranscript(root, userText) {
  const tp = path.join(root, 'transcript.jsonl');
  const rows = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'earlier unrelated turn' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'ok' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: userText } }),
  ];
  fs.writeFileSync(tp, rows.join('\n') + '\n');
  return tp;
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

test('injects fresh hits from transcript last-user-message, then dedups on repeat', async () => {
  const root = tmpRoot();
  const reply = { hits: [{ path: 'docs/y.md', startLine: 7, heading: 'Guide', snippet: 'body', score: 0.9 }], injected: true };
  const server = await startStub(root, reply);
  const transcript = writeTranscript(root, 'explain the caching strategy in detail');
  try {
    const event = {
      cwd: root,
      session_id: 'sess-1',
      transcript_path: transcript,
      hook_event_name: 'PostToolBatch',
    };

    const first = await runHook(event);
    const parsed = JSON.parse(first);
    assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PostToolBatch');
    assert.match(parsed.hookSpecificOutput.additionalContext, /docs\/y\.md:7/);

    // Second identical run: same session, same hit path → deduped → silent.
    const second = await runHook(event);
    assert.strictEqual(second, '');
  } finally {
    server.close();
  }
});

test('silent when the socket is absent', async () => {
  const root = tmpRoot();
  const transcript = writeTranscript(root, 'explain the caching strategy in detail');
  const out = await runHook({ cwd: root, session_id: 's', transcript_path: transcript, hook_event_name: 'PostToolUse' });
  assert.strictEqual(out, '');
});

test('silent when batch events are disabled via REPO_DOCS_INJECT_EVENTS', async () => {
  const root = tmpRoot();
  const server = await startStub(root, { hits: [{ path: 'docs/z.md', startLine: 1 }], injected: true });
  const transcript = writeTranscript(root, 'explain the caching strategy in detail');
  try {
    const out = await runHook(
      { cwd: root, session_id: 's2', transcript_path: transcript },
      { ...process.env, REPO_DOCS_INJECT_EVENTS: 'prompt' },
    );
    assert.strictEqual(out, '');
  } finally {
    server.close();
  }
});
