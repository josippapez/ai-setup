'use strict';

const os = require('node:os');
const path = require('node:path');

// The only runtime file that differs from the Claude Code plugin in
// claude/plugins/repo-docs/runtime: the per-repo folder that holds the index and
// the ignore file. Models live in the same folder as Claude Code's, next to the
// shared model server's socket, so both harnesses share one download and one loaded
// copy; REPO_DOCS_MODELS_DIR overrides it.
module.exports = {
  CONFIG_DIR: '.opencode',
  MODELS_DIR: path.join(os.homedir(), '.claude', 'models'),
};
