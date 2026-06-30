'use strict';

const { walkDirectory } = require('./fs-utils.cjs');

// Index every Markdown file in the repo. walkDirectory already prunes the
// standard noise directories (node_modules, .git, dist, …) via SKIP_DIRS.
function getDocFiles(context) {
  const files = [];
  walkDirectory(context.root, (filePath) => {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.md') || lower.endsWith('.mdx')) files.push(filePath);
  });
  return Array.from(new Set(files));
}

module.exports = { getDocFiles };
