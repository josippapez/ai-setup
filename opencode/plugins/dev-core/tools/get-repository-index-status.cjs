'use strict';

const {
  startDependencyIndex,
  getDependencyIndexState,
} = require('../lib/dependency-index.cjs');

const definition = {
  name: 'get_repository_index_status',
  description:
    "Report the dependency-graph index status for the repo. Indexing starts automatically when the server connects, so call this to watch progress (status 'building' with files processed/total and a percentage) or confirm completion (status 'ready' with file and edge counts). Takes no arguments. If indexing hasn't started yet, calling this kicks it off. Returns repo root, status (building/ready/error/idle), progress or counts, and watcher state (always 'no' — the index is a point-in-time snapshot).",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

function execute(_args, context) {
  // Ensure indexing is underway (idempotent, non-blocking — we read the live
  // snapshot rather than awaiting completion so progress is observable).
  startDependencyIndex(context).catch(() => {});
  const state = getDependencyIndexState(context);

  if (state.status === 'ready' && state.index) {
    return [
      `repo ${context.root}`,
      'status ready',
      `files ${state.index.sourceFiles.length}/${state.index.sourceFiles.length}`,
      `edges ${state.index.edgeCount}`,
      'watcher no',
    ].join('\n');
  }

  if (state.status === 'building') {
    const pct = state.total
      ? Math.round((state.processed / state.total) * 100)
      : 0;
    return [
      `repo ${context.root}`,
      'status building',
      `progress ${state.processed}/${state.total} files (${pct}%)`,
      'watcher no',
    ].join('\n');
  }

  if (state.status === 'error') {
    return [`repo ${context.root}`, 'status error', 'watcher no'].join('\n');
  }

  return [`repo ${context.root}`, 'status idle', 'watcher no'].join('\n');
}

module.exports = { repositoryIndexStatusTool: { definition, execute } };
