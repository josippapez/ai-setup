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
  }, { injectDebug: true });
  const chatOutput = {
    message: { id: 'message-test' },
    parts: [{ type: 'text', text: 'How does authentication work in this repository?' }],
  };
  await hooks['chat.message'](
    { sessionID: 'session-test' },
    chatOutput,
  );
  assert.match(chatOutput.message.system, /<system-reminder>/);
  assert.match(chatOutput.message.system, /docs\/auth\.md:12/);
  const output = {
    messages: [{
      info: {
        id: 'message-test',
        role: 'user',
        sessionID: 'session-test',
        system: chatOutput.message.system,
      },
      parts: [{ type: 'text', text: 'How does authentication work in this repository?' }],
    }],
  };
  await hooks['experimental.chat.messages.transform']({}, output);
  const systemOutput = { system: ['BASE_SYSTEM'] };
  await hooks['experimental.chat.system.transform'](
    { sessionID: 'session-test' },
    systemOutput,
  );

  const transformed = output.messages[0].info.system;
  assert.match(transformed, /<system-reminder>/);
  assert.match(transformed, /docs\/auth\.md:12/);
  assert.match(transformed, /interactive-mcp-standalone_read_doc/);
  assert.doesNotMatch(systemOutput.system[0], /docs\/auth\.md:12/);
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
  const progressSystem = { system: ['BASE_SYSTEM'] };
  await hooks['experimental.chat.system.transform'](
    { sessionID: 'session-test' },
    progressSystem,
  );
  // Same session, same doc: already injected for the prompt above, so the
  // progress pass must stay silent rather than repeat it.
  assert.doesNotMatch(progressSystem.system[0], /docs\/auth\.md:12/);

  const directOutput = {
    messages: [{
      info: { id: 'message-direct', role: 'user', sessionID: 'session-direct' },
      parts: [{ type: 'text', text: 'Where are authentication rules documented?' }],
    }],
  };
  await hooks['experimental.chat.messages.transform']({}, directOutput);
  const directSystem = { system: ['BASE_SYSTEM'] };
  await hooks['experimental.chat.system.transform'](
    { sessionID: 'session-direct' },
    directSystem,
  );
  assert.match(directSystem.system[0], /<system-reminder>/);
  assert.match(directSystem.system[0], /docs\/auth\.md:12/);
  assert.match(
    fs.readFileSync(path.join(root, '.opencode', 'repo-docs', 'inject-debug.log'), 'utf8'),
    /query result injected=true hits=1/,
  );
  await new Promise((resolve) => server.close(resolve));
});

test('source-file edits request dependency-graph invalidation over the socket', async () => {
  // Short prefix: the socket path below must stay under the 104-char unix
  // socket limit on macOS.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-deps-'));
  const socketPath = path.join(root, '.opencode', 'repo-docs', 'inject.sock');
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  const received = [];
  const server = net.createServer((connection) => {
    connection.on('data', (data) => {
      try { received.push(JSON.parse(String(data).trim())); } catch {}
      connection.end(`${JSON.stringify({ ok: true })}\n`);
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));

  const hooks = await interactiveMcpPlugin({
    directory: root,
    serverUrl: new URL('http://localhost:4096'),
  });
  await hooks['tool.execute.after']({
    sessionID: 'session-deps',
    tool: 'edit',
    args: { filePath: path.join(root, 'src/app.ts') },
  });
  for (let i = 0; i < 50 && received.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  // Close before asserting so a failure can't leave the server holding the
  // event loop open (node --test would hang instead of reporting).
  await new Promise((resolve) => server.close(resolve));
  assert.ok(
    received.some((message) => message.op === 'invalidate-deps'),
    'a source edit must send an invalidate-deps op',
  );
});
