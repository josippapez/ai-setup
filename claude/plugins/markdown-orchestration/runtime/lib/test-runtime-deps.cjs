'use strict';

// Test-only support. The heavy runtime deps (@orama, @huggingface/transformers)
// are deliberately not vendored: the SessionStart hook npm-installs them into
// the plugin's data dir and the MCP server is launched with NODE_PATH pointing
// there (see .mcp.json). A bare `node --test` inherits neither, so every
// orama-backed test used to die on "Cannot find module '@orama/orama'".
//
// Locate an installed copy, point NODE_PATH at it and re-init Node's global
// module paths so bare specifiers resolve. Returns false when nothing is
// installed yet (fresh checkout, no session run) so callers skip with a real
// reason instead of failing on a missing module.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const req = Module.createRequire(__filename);

function resolvable() {
  try {
    req.resolve('@orama/orama');
    return true;
  } catch {
    return false;
  }
}

// Every installed plugin keeps its deps under ~/.claude/plugins/data/<id>/node_modules.
// Any of them will do — they are installed from the same plugin package.json.
function candidateModuleDirs() {
  const dataRoot = path.join(os.homedir(), '.claude', 'plugins', 'data');
  let entries = [];
  try {
    entries = fs.readdirSync(dataRoot);
  } catch {
    return [];
  }
  return entries.map((name) => path.join(dataRoot, name, 'node_modules'));
}

let state = null;

function ensureRuntimeDeps() {
  if (state !== null) return state;
  if (resolvable()) {
    state = true;
    return state;
  }
  for (const dir of candidateModuleDirs()) {
    if (!fs.existsSync(path.join(dir, '@orama', 'orama'))) continue;
    process.env.NODE_PATH = process.env.NODE_PATH
      ? `${dir}${path.delimiter}${process.env.NODE_PATH}`
      : dir;
    Module._initPaths();
    if (resolvable()) {
      state = true;
      return state;
    }
  }
  state = false;
  return state;
}

// `skip` value for node:test options — false when deps are present.
function skipWithoutRuntimeDeps() {
  return ensureRuntimeDeps()
    ? false
    : 'runtime deps not installed — start a Claude Code session once so the SessionStart hook runs npm install, then re-run';
}

module.exports = { ensureRuntimeDeps, skipWithoutRuntimeDeps };
