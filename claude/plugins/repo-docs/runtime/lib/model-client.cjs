'use strict';

// Client for model-server.cjs: embed() and rerank() resolve the server's result, or
// null whenever the server cannot be used, so the caller loads the model itself.
// The first caller on a machine starts the server (detached, so it outlives the session
// that started it); every later one connects to the socket.

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { PROTOCOL } = require('./model-server.cjs');

const SERVER_FILE = path.join(__dirname, 'model-server.cjs');
const CONNECT_WAIT_MS = 5000;
const LOCK_STALE_MS = 30000;
// After a failed attempt, later calls return null at once instead of each waiting up to
// CONNECT_WAIT_MS for a server that is not coming.
const RETRY_MS = Number(process.env.MODEL_CLIENT_RETRY_MS) > 0 ? Number(process.env.MODEL_CLIENT_RETRY_MS) : 30000;

const dir = () => process.env.MODEL_SERVER_DIR || path.join(os.homedir(), '.claude', 'models');
const socketPath = () => path.join(dir(), 'model-server.sock');
const lockPath = () => path.join(dir(), 'model-server.lock');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connectOnce(sock) {
  return new Promise((resolve, reject) => {
    const s = net.connect(sock);
    s.once('connect', () => resolve(s));
    s.once('error', reject);
  });
}

function takeLock() {
  fs.mkdirSync(dir(), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath(), 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') return false;
      let stale = false;
      try {
        const pid = Number(fs.readFileSync(lockPath(), 'utf8'));
        try { process.kill(pid, 0); } catch (e) { stale = e.code === 'ESRCH'; }
        if (Date.now() - fs.statSync(lockPath()).mtimeMs > LOCK_STALE_MS) stale = true;
      } catch { stale = true; }
      if (!stale) return false;
      fs.rmSync(lockPath(), { force: true });
    }
  }
  return false;
}

function spawnServer(sock) {
  const env = { ...process.env };
  if (!process.env.MODEL_SERVER_LOADER) {
    // The server resolves @huggingface/transformers from NODE_PATH, so hand it the
    // node_modules directory this caller resolves it from.
    let entry;
    try { entry = require.resolve('@huggingface/transformers'); } catch { return false; }
    const marker = `${path.sep}node_modules${path.sep}@huggingface`;
    const at = entry.lastIndexOf(marker);
    if (at < 0) return false;
    const modules = entry.slice(0, at + `${path.sep}node_modules`.length);
    env.NODE_PATH = process.env.NODE_PATH ? `${modules}${path.delimiter}${process.env.NODE_PATH}` : modules;
  }
  const child = spawn(process.execPath, [SERVER_FILE, sock], { detached: true, stdio: 'ignore', env });
  child.on('error', () => {});
  child.unref();
  return true;
}

async function waitForSocket(sock) {
  const until = Date.now() + CONNECT_WAIT_MS;
  while (Date.now() < until) {
    try { return await connectOnce(sock); } catch { await sleep(50); }
  }
  return null;
}

async function connectOrStart(sock) {
  try { return await connectOnce(sock); } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'ECONNREFUSED') return null;
  }
  if (!takeLock()) return waitForSocket(sock);
  try {
    // A server may have come up between the failed connect and taking the lock.
    try { return await connectOnce(sock); } catch {}
    return spawnServer(sock) ? await waitForSocket(sock) : null;
  } finally {
    fs.rmSync(lockPath(), { force: true });
  }
}

function wrap(socket) {
  const conn = { socket, dead: false, pending: new Map(), nextId: 0 };
  let buf = '';
  // The socket keeps the process alive only while a request is waiting.
  const settle = () => (conn.pending.size ? socket.ref() : socket.unref());
  const die = () => {
    conn.dead = true;
    for (const done of conn.pending.values()) done({ error: 'connection closed' });
    conn.pending.clear();
  };
  socket.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const done = conn.pending.get(msg.id);
      if (!done) continue;
      conn.pending.delete(msg.id);
      settle();
      done(msg);
    }
  });
  socket.on('error', die);
  socket.on('close', die);
  conn.call = (op, body) => new Promise((resolve) => {
    if (conn.dead) { resolve({ error: 'connection closed' }); return; }
    const id = ++conn.nextId;
    conn.pending.set(id, resolve);
    settle();
    socket.write(JSON.stringify({ ...body, id, op }) + '\n');
  });
  socket.unref();
  return conn;
}

const conns = new Map(); // socket path -> Promise of a live connection or null
const failedAt = new Map();

async function open(sock) {
  const socket = await connectOrStart(sock);
  if (!socket) return null;
  const conn = wrap(socket);
  const hello = await conn.call('hello', {});
  if (!hello.result || hello.result.version !== PROTOCOL) { socket.destroy(); return null; }
  return conn;
}

async function getConn() {
  if (process.env.MODEL_SERVER_DISABLE === '1') return null;
  const sock = socketPath();
  const known = conns.get(sock);
  if (known) {
    const conn = await known;
    if (conn && !conn.dead) return conn;
    conns.delete(sock);
  }
  if (Date.now() - (failedAt.get(sock) || 0) < RETRY_MS) return null;
  const attempt = open(sock).catch(() => null);
  conns.set(sock, attempt);
  const conn = await attempt;
  if (!conn) { failedAt.set(sock, Date.now()); conns.delete(sock); }
  return conn;
}

async function call(op, body) {
  const conn = await getConn();
  if (!conn) return null;
  const res = await conn.call(op, body);
  return res.result || null;
}

// { model, texts, load: { device?, dtype, fallbackDtype?, sessionOptions?, maxTokens?, cacheDir },
//   pooling, normalize, priority: 'query' | 'bulk' } -> { vectors: (number[] | null)[] } | null
function embed(opts) { return call('embed', opts); }

// { model, query, texts, load: { dtype, sessionOptions, cacheDir } } -> { order } | null
function rerank(opts) { return call('rerank', opts); }

// For tests: drop every connection and the failure memory.
function close() {
  for (const p of conns.values()) p.then((c) => c && c.socket.destroy());
  conns.clear();
  failedAt.clear();
}

module.exports = { embed, rerank, close, PROTOCOL };
