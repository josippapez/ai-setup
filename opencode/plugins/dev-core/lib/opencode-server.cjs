'use strict';

const { spawn } = require('node:child_process');

const SERVER_START_TIMEOUT_MS = 30000;
const SERVER_HEALTH_CHECK_INTERVAL_MS = 500;
const SERVER_HEALTH_CHECK_TIMEOUT_MS = 2000;

async function isServerReachable(url, timeoutMs = SERVER_HEALTH_CHECK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForServer(url, timeoutMs = SERVER_START_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerReachable(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, SERVER_HEALTH_CHECK_INTERVAL_MS));
  }
  return false;
}

function startOpenCodeServer(port, cwd) {
  const child = spawn('opencode', ['serve', '--port', String(port)], {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (err) => {
    process.stderr.write(`failed to start opencode serve: ${err.message}\n`);
  });
  child.unref();
  return child;
}

async function ensureOpenCodeServer(serverUrl, root) {
  if (await isServerReachable(serverUrl)) {
    return;
  }

  let port;
  try {
    port = new URL(serverUrl).port || '4096';
  } catch {
    port = '4096';
  }

  process.stderr.write(
    `OpenCode server not reachable at ${serverUrl}; starting opencode serve --port ${port} in the background...\n`,
  );
  startOpenCodeServer(port, root);

  const ready = await waitForServer(serverUrl);
  if (!ready) {
    const message = `OpenCode server at ${serverUrl} did not become reachable within ${SERVER_START_TIMEOUT_MS}ms.`;
    process.stderr.write(`${message} Some tools may fail until it is started manually.\n`);
    throw new Error(message);
  }

  process.stderr.write(`OpenCode server at ${serverUrl} is now reachable.\n`);
}

module.exports = { ensureOpenCodeServer };
