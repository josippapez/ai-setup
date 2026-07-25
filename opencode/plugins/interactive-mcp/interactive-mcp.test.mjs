import assert from 'node:assert';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import interactiveMcpPlugin from './interactive-mcp.js';

test('injects relevant repository docs into system context for a user prompt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-plugin-'));
  const socketPath = path.join(root, '.opencode', 'repo-docs', 'inject.sock');
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  const server = net.createServer((connection) => {
    connection.on('data', () => {
      connection.end(`${JSON.stringify({
        injected: true,
        hits: [{
          path: 'docs/auth.md',
          startLine: 12,
          heading: 'Authentication',
          snippet: 'Use short-lived access tokens.',
        }],
      })}\n`);
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));

  const hooks = await interactiveMcpPlugin({
    directory: root,
    serverUrl: new URL('http://localhost:4096'),
  });
  await hooks['chat.message'](
    { sessionID: 'session-test' },
    { parts: [{ type: 'text', text: 'How does authentication work in this repository?' }] },
  );
  const output = {
    messages: [{
      info: { role: 'user', sessionID: 'session-test' },
      parts: [{ type: 'text', text: 'How does authentication work in this repository?' }],
    }],
  };
  await hooks['experimental.chat.messages.transform']({}, output);

  const transformed = output.messages[0].info.system;
  assert.match(transformed, /<system-reminder>/);
  assert.match(transformed, /docs\/auth\.md:12/);
  assert.match(transformed, /interactive-mcp-standalone_read_doc/);
  assert.strictEqual(
    output.messages[0].parts[0].text,
    'How does authentication work in this repository?',
  );

  output.messages[0].info.system = undefined;
  await hooks['tool.execute.after']({
    sessionID: 'session-test',
    tool: 'read',
    args: { path: 'src/auth.ts' },
  });
  await hooks['experimental.chat.messages.transform']({}, output);
  assert.match(output.messages[0].info.system, /<system-reminder>/);
  assert.match(output.messages[0].info.system, /docs\/auth\.md:12/);
  await new Promise((resolve) => server.close(resolve));
});
