import assert from 'node:assert';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import devCorePlugin from './index.js';

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
  const registrations = {};
  const hooks = {
    mcp: { transform: async (callback) => callback({ set: (name, config) => { registrations[name] = config; } }) },
    tool: { hook: async (name, callback) => { registrations[name] = callback; } },
    shell: { hook: async (name, callback) => { registrations.shell = callback; } },
    session: { hook: async (name, callback) => { registrations.session = callback; } },
  };
  await devCorePlugin.setup({ location: { directory: root, project: { directory: root } }, ...hooks });
  assert.strictEqual(registrations['repo-docs'].type, 'local');
  assert.match(registrations['repo-docs'].command[1], /standalone-mcp\.cjs$/);
  assert.strictEqual(registrations['repo-docs'].command[2], root);

  await registrations['execute.before']({ sessionID: 's1' });
  const systemOutput = { system: [] };
  registrations.session({ sessionID: 's1', system: systemOutput.system });
  assert.match(systemOutput.system[0].text, /Current OpenCode session ID: s1/);
  const env = { env: {} };
  await registrations.shell({ sessionID: 's1', env });
  assert.strictEqual(env.OPENCODE_SESSION_ID, 's1');
});

test('a Markdown edit requests a reindex over the socket', async () => {
  const received = [];
  const { root, server } = await rootWithStub(received);
  const after = {};
  await devCorePlugin.setup({
    location: { directory: root, project: { directory: root } },
    mcp: { transform: async () => {} },
    tool: { hook: async (name, callback) => { after[name] = callback; } },
    shell: { hook: async () => {} },
    session: { hook: async () => {} },
  });
  await after['execute.after']({ tool: 'edit', input: { filePath: path.join(root, 'docs/auth.md') } });
  await settle(received);
  await new Promise((resolve) => server.close(resolve));
  assert.deepStrictEqual(received, [{ op: 'reindex' }]);
});

test('a source-file edit sends nothing', async () => {
  const received = [];
  const { root, server } = await rootWithStub(received);
  const after = {};
  await devCorePlugin.setup({
    location: { directory: root, project: { directory: root } },
    mcp: { transform: async () => {} },
    tool: { hook: async (name, callback) => { after[name] = callback; } },
    shell: { hook: async () => {} },
    session: { hook: async () => {} },
  });
  await after['execute.after']({ tool: 'edit', input: { filePath: path.join(root, 'src/app.ts') } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  await new Promise((resolve) => server.close(resolve));
  assert.deepStrictEqual(received, []);
});
