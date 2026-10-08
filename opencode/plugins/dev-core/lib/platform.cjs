'use strict';

const os = require('node:os');
const path = require('node:path');

// The only runtime file that differs from the Claude Code plugin in
// claude/plugins/repo-docs/runtime: the per-repo folder that holds the index and
// the ignore file, and where models are cached unless REPO_DOCS_MODELS_DIR is set.
module.exports = {
  CONFIG_DIR: '.opencode',
  MODELS_DIR: path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode', 'repo-docs-models'),
};
