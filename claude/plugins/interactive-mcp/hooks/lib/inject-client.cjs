'use strict';
const net = require('node:net');
const path = require('node:path');

function injectSocketPath(root) {
  return path.join(root, '.claude', 'repo-docs', 'inject.sock');
}

// Connect, send one NDJSON request, resolve the parsed reply. Any error, timeout,
// or absent socket → null (caller injects nothing). Socket presence is the gate.
function queryInject(root, req, timeoutMs = 300) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const c = net.connect(injectSocketPath(root));
    const timer = setTimeout(() => { c.destroy(); finish(null); }, timeoutMs);
    let buf = '';
    c.on('connect', () => c.write(JSON.stringify(req) + '\n'));
    c.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      clearTimeout(timer); c.end();
      try { finish(JSON.parse(buf.slice(0, nl))); } catch { finish(null); }
    });
    c.on('error', () => { clearTimeout(timer); finish(null); });
    c.on('close', () => { clearTimeout(timer); finish(null); });
  });
}

function formatBlock(hits) {
  if (!hits || hits.length === 0) return '';
  const lines = hits.map((h, i) => {
    const anchor = h.heading ? ` › ${h.heading}` : '';
    return `${i + 1}) ${h.path}:${h.startLine}${anchor} — ${h.snippet}`;
  });
  return `[repo-docs] Possibly relevant local docs — open with read_doc if useful:\n${lines.join('\n')}`;
}

module.exports = { injectSocketPath, queryInject, formatBlock };
