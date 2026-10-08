'use strict';

const os = require('node:os');
const path = require('node:path');

// The only runtime file that differs from the OpenCode copy in
// opencode/plugins/dev-core: the per-repo folder that holds the index and the
// ignore file, and where models are cached unless REPO_DOCS_MODELS_DIR is set.
module.exports = {
  CONFIG_DIR: '.claude',
  MODELS_DIR: path.join(os.homedir(), '.claude', 'repo-docs-models'),
};
