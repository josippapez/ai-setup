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

// Stub server that always replies with a fixed payload, regardless of the request.
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

// Stub server that captures the request and replies with `reply` only when
// `matches(query)` is true (otherwise empty hits) — used to assert the hook
// built its query from the intended source (agent text / thin-fallback / tool target).
function startMatchingStub(root, matches, reply) {
  const sock = injectSocketPath(root);
  fs.mkdirSync(path.dirname(sock), { recursive: true });
  try { fs.rmSync(sock, { force: true }); } catch {}
  let lastRequest = null;
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      let req = null;
      try { req = JSON.parse(buf.slice(0, nl)); } catch {}
      lastRequest = req;
      const out = req && matches(req.query) ? reply : { hits: [], injected: false };
      conn.end(JSON.stringify(out) + '\n');
    });
    conn.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(sock, () => resolve({ server, getRequest: () => lastRequest })));
}

function writeTranscriptRows(root, rows) {
  const tp = path.join(root, 'transcript.jsonl');
  fs.writeFileSync(tp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return tp;
}

function userRow(text) {
  return { type: 'user', message: { role: 'user', content: text } };
}
function assistantRow(content) {
  return { type: 'assistant', message: { role: 'assistant', content } };
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

test('injects when the agent\'s latest output text drives the query', async () => {
  const root = tmpRoot();
  const reply = { hits: [{ path: 'docs/y.md', startLine: 7, heading: 'Guide', snippet: 'body', score: 0.9 }], injected: true };
  const { server } = await startMatchingStub(root, (q) => /react hook form/i.test(q), reply);
  const transcript = writeTranscriptRows(root, [
    userRow('add a form'),
    assistantRow([
      { type: 'text', text: 'I will use react hook form for validation' },
      { type: 'tool_use', name: 'Write', input: { file_path: 'src/authForm.tsx' } },
    ]),
  ]);
  try {
    const event = { cwd: root, session_id: 'sess-1', transcript_path: transcript, hook_event_name: 'PostToolBatch' };

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

test('thin-fallback: falls back to the last user message when assistant text is too short', async () => {
  const root = tmpRoot();
  const reply = { hits: [{ path: 'docs/rhf.md', startLine: 3 }], injected: true };
  const { server, getRequest } = await startMatchingStub(root, (q) => /react hook form/i.test(q), reply);
  const transcript = writeTranscriptRows(root, [
    userRow('set up react hook form'),
    assistantRow([{ type: 'tool_use', name: 'Write', input: { file_path: 'src/authForm.tsx' } }]),
  ]);
  try {
    const out = await runHook({ cwd: root, session_id: 'sess-2', transcript_path: transcript, hook_event_name: 'PostToolBatch' });
    const parsed = JSON.parse(out);
    assert.match(parsed.hookSpecificOutput.additionalContext, /docs\/rhf\.md:3/);
    assert.match(getRequest().query, /react hook form/i);
  } finally {
    server.close();
  }
});

test('tool-target: query includes the edited file basename', async () => {
  const root = tmpRoot();
  const reply = { hits: [{ path: 'docs/z.md', startLine: 1 }], injected: true };
  const { server, getRequest } = await startMatchingStub(root, (q) => q.includes('authForm.tsx'), reply);
  const transcript = writeTranscriptRows(root, [
    userRow('add a form'),
    assistantRow([
      { type: 'text', text: 'I will use react hook form for validation' },
      { type: 'tool_use', name: 'Write', input: { file_path: 'src/authForm.tsx' } },
    ]),
  ]);
  try {
    const out = await runHook({ cwd: root, session_id: 'sess-3', transcript_path: transcript, hook_event_name: 'PostToolBatch' });
    const parsed = JSON.parse(out);
    assert.match(parsed.hookSpecificOutput.additionalContext, /docs\/z\.md:1/);
    assert.match(getRequest().query, /authForm\.tsx/);
  } finally {
    server.close();
  }
});

test('silent when the socket is absent', async () => {
  const root = tmpRoot();
  const transcript = writeTranscriptRows(root, [
    userRow('add a form'),
    assistantRow([{ type: 'text', text: 'explain the caching strategy in detail' }]),
  ]);
  const out = await runHook({ cwd: root, session_id: 's', transcript_path: transcript, hook_event_name: 'PostToolUse' });
  assert.strictEqual(out, '');
});

test('silent when batch events are disabled via REPO_DOCS_INJECT_EVENTS', async () => {
  const root = tmpRoot();
  const server = await startStub(root, { hits: [{ path: 'docs/z.md', startLine: 1 }], injected: true });
  const transcript = writeTranscriptRows(root, [
    userRow('add a form'),
    assistantRow([{ type: 'text', text: 'explain the caching strategy in detail' }]),
  ]);
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

test('silent for chit-chat filler even when the stub server would return hits', async () => {
  const root = tmpRoot();
  const server = await startStub(root, { hits: [{ path: 'docs/z.md', startLine: 1, score: 0.99 }], injected: true });
  // Assistant's latest text is itself unmistakable filler and long enough to skip
  // the thin-fallback (>=12 alpha chars), so the filler check is exercised directly.
  const transcript = writeTranscriptRows(root, [
    userRow('add a form'),
    assistantRow([{ type: 'text', text: 'thanks that looks good' }]),
  ]);
  try {
    const out = await runHook({ cwd: root, session_id: 's3', transcript_path: transcript, hook_event_name: 'PostToolBatch' });
    assert.strictEqual(out, '');
  } finally {
    server.close();
  }
});

test('uses default progress threshold 0.86 when no env override is set', async () => {
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
  const transcript = writeTranscriptRows(root, [
    userRow('add a form'),
    assistantRow([{ type: 'text', text: 'explain the caching strategy in detail' }]),
  ]);
  try {
    const cleanEnv = { ...process.env };
    delete cleanEnv.REPO_DOCS_INJECT_THRESHOLD;
    delete cleanEnv.REPO_DOCS_INJECT_THRESHOLD_PROGRESS;
    await runHook(
      { cwd: root, session_id: 's4', transcript_path: transcript, hook_event_name: 'PostToolBatch' },
      cleanEnv,
    );
    assert.ok(captured, 'expected the hook to reach the stub server');
    assert.strictEqual(captured.threshold, 0.86);
  } finally {
    server.close();
  }
});
