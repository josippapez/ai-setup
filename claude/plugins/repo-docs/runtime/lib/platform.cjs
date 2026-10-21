'use strict';

const os = require('node:os');
const path = require('node:path');

// The only runtime file that differs from the OpenCode copy in
// opencode/plugins/dev-core: the per-repo folder that holds the index and the
// ignore file. Models live in one folder for both harnesses and every plugin, next
// to the shared model server's socket, so each downloads once and the server holds
// one copy; REPO_DOCS_MODELS_DIR overrides it.
module.exports = {
  CONFIG_DIR: '.claude',
  MODELS_DIR: path.join(os.homedir(), '.claude', 'models'),
};
