'use strict';

const { getDependencyIndex } = require('../lib/dependency-index.cjs');

const definition = {
  name: 'get_repository_index_status',
  description:
    "Report the dependency-graph index for the repo: number of source files scanned and total import edges. Use to confirm the graph is built / gauge its size before relying on get_file_dependencies, get_file_dependents, or get_blast_radius. Takes no arguments. Calling it builds the index if not already cached this session. Returns repo root, status, files count, edge count, and watcher state (always 'no' — the index is a point-in-time snapshot).",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

function execute(_args, context) {
  const index = getDependencyIndex(context);
  return [
    `repo ${context.root}`,
    'status ready',
    `files ${index.sourceFiles.length}/${index.sourceFiles.length}`,
    `edges ${index.edgeCount}`,
    'watcher no',
  ].join('\n');
}

module.exports = { repositoryIndexStatusTool: { definition, execute } };
