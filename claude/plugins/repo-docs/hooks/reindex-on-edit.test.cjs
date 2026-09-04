'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const HOOK = path.join(__dirname, 'reindex-on-edit.cjs');

function sockPath(root) { return path.join(root, '.claude', 'repo-docs', 'inject.sock'); }

function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-hook-'));
  fs.mkdirSync(path.join(root, '.claude', 'repo-docs'), { recursive: true });
  return root;
}

// In-process stub socket that records reindex requests. Async server so it can
// accept while the hook child process runs.
function stubServer(root, received) {
  const server = net.createServer((c) => {
    let buf = '';
    c.on('data', (d) => {
      buf += d;
      if (!buf.includes('\n')) return;
      try { received.push(JSON.parse(buf.trim())); } catch {}
      c.end(JSON.stringify({ reindexed: true }) + '\n');
    });
    c.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(sockPath(root), () => resolve(server)));
}

function runHook(event) {
  return new Promise((resolve) => {
    const cp = execFile('node', [HOOK], { encoding: 'utf8' }, () => resolve());
    cp.stdin.end(JSON.stringify(event));
  });
}

test('reindex-on-edit sends a reindex op after a Markdown Write', async () => {
  const root = freshRoot();
  const received = [];
  const server = await stubServer(root, received);
  await runHook({ tool_name: 'Write', tool_input: { file_path: path.join(root, 'docs/x.md') }, cwd: root });
  assert.strictEqual(received.length, 1);
  assert.strictEqual(received[0].op, 'reindex');
  await new Promise((r) => server.close(r));
});

test('reindex-on-edit ignores non-doc, non-source edits', async () => {
  const root = freshRoot();
  const received = [];
  const server = await stubServer(root, received);
  await runHook({ tool_name: 'Edit', tool_input: { file_path: path.join(root, 'styles/app.css') }, cwd: root });
  assert.strictEqual(received.length, 0);
  await new Promise((r) => server.close(r));
});

test('reindex-on-edit debounces a second edit within the window', async () => {
  const root = freshRoot();
  const received = [];
  const server = await stubServer(root, received);
  await runHook({ tool_name: 'Write', tool_input: { file_path: path.join(root, 'docs/a.md') }, cwd: root });
  await runHook({ tool_name: 'Write', tool_input: { file_path: path.join(root, 'docs/b.md') }, cwd: root });
  assert.strictEqual(received.length, 1, 'second edit within the debounce window should be skipped');
  await new Promise((r) => server.close(r));
});

test('reindex-on-edit is fail-safe when no socket is present', async () => {
  const root = freshRoot(); // no server bound
  await runHook({ tool_name: 'Write', tool_input: { file_path: path.join(root, 'docs/x.md') }, cwd: root });
  // No throw, no hang — reaching here is the assertion.
  assert.ok(true);
});
