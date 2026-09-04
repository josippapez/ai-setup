import assert from 'node:assert';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import devCorePlugin from './dev-core.js';

// Short prefix: the socket path must stay under the 104-char unix socket
// limit on macOS.
function rootWithStub(received) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-dc-'));
  const socketPath = path.join(root, '.opencode', 'repo-docs', 'inject.sock');
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  const server = net.createServer((connection) => {
    connection.on('data', (data) => {
      try { received.push(JSON.parse(String(data).trim())); } catch {}
      connection.end(`${JSON.stringify({ reindexed: true })}\n`);
    });
  });
  return new Promise((resolve) => server.listen(socketPath, () => resolve({ root, server })));
}

async function settle(received) {
  for (let i = 0; i < 50 && received.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('registers the repo-docs MCP server and the session id in the system prompt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-dc-cfg-'));
  const hooks = await devCorePlugin({ directory: root, serverUrl: new URL('http://localhost:4096') });
  const config = { mcp: { existing: { type: 'remote', url: 'http://x' } } };
  await hooks.config(config);
  assert.ok(config.mcp.existing, 'existing servers are preserved');
  assert.strictEqual(config.mcp['repo-docs'].type, 'local');
  assert.match(config.mcp['repo-docs'].command[1], /standalone-mcp\.cjs$/);
  assert.strictEqual(config.mcp['repo-docs'].command[2], root);

  const systemOutput = { system: ['BASE_SYSTEM'] };
  await hooks['experimental.chat.system.transform']({ sessionID: 's1' }, systemOutput);
  assert.match(systemOutput.system[0], /Current OpenCode session ID: s1/);
  const env = { env: {} };
  await hooks['shell.env']({ sessionID: 's1' }, env);
  assert.strictEqual(env.env.OPENCODE_SESSION_ID, 's1');
});

test('a Markdown edit requests a reindex over the socket', async () => {
  const received = [];
  const { root, server } = await rootWithStub(received);
  const hooks = await devCorePlugin({ directory: root, serverUrl: new URL('http://localhost:4096') });
  await hooks['tool.execute.after']({ sessionID: 's', tool: 'edit', args: { filePath: path.join(root, 'docs/auth.md') } });
  await settle(received);
  await new Promise((resolve) => server.close(resolve));
  assert.deepStrictEqual(received, [{ op: 'reindex' }]);
});

test('a source-file edit sends nothing', async () => {
  const received = [];
  const { root, server } = await rootWithStub(received);
  const hooks = await devCorePlugin({ directory: root, serverUrl: new URL('http://localhost:4096') });
  await hooks['tool.execute.after']({ sessionID: 's', tool: 'edit', args: { filePath: path.join(root, 'src/app.ts') } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  await new Promise((resolve) => server.close(resolve));
  assert.deepStrictEqual(received, []);
});
