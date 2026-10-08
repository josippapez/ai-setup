'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// This plugin runs a copy of the Claude Code repo-docs runtime. The copy fell
// behind once (no keyword fallback, older model, one-line output), so every
// runtime file must match the source except the ones that hold the real
// differences. Fix a failure by copying the file from the source.
const SOURCE = path.join(__dirname, '..', '..', '..', 'claude', 'plugins', 'repo-docs', 'runtime');
const OWN = new Set(['lib/platform.cjs', 'lib/context.cjs', 'standalone-mcp.cjs']);

function files(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(entry => {
    const child = path.posix.join(rel, entry.name);
    return entry.isDirectory() ? files(dir, child) : [child];
  });
}

test('every repo-docs runtime file matches the Claude Code plugin', { skip: !fs.existsSync(SOURCE) && 'source repo not present (installed copy)' }, () => {
  const drifted = files(SOURCE).filter(rel => !OWN.has(rel)).filter(rel => {
    const copy = path.join(__dirname, rel);
    return !fs.existsSync(copy) || !fs.readFileSync(copy).equals(fs.readFileSync(path.join(SOURCE, rel)));
  });
  assert.deepStrictEqual(drifted, [], `copy these from ${path.relative(process.cwd(), SOURCE)}`);
});
