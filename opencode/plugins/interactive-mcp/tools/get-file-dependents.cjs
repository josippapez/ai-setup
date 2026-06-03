'use strict';

const { getDependencyIndex } = require('../lib/dependency-index.cjs');

const definition = {
  name: 'get_file_dependents',
  description:
    "List the direct (one-hop) dependents of a JS/TS file — i.e. every source file that imports it. Use to assess immediate impact before changing or deleting a module: 'who imports this', 'what breaks if I change this file'. Input is a repo-relative path; returns one line per importing file with its relative import specifier, or 'none'. Only relative imports are tracked, so importers that reference the file via a package/path alias won't appear. For transitive (multi-hop) impact use get_blast_radius.",
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Repo-root-relative path of the file whose importers you want (e.g. libs/shared/api/src/client.ts). Required.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

function execute(args, context) {
  const rel = String(args.path || '').trim();
  if (!rel) return 'Please provide a non-empty path.';
  const index = getDependencyIndex(context);
  const edges = index.dependentsByFile.get(rel) || [];
  const header = `repo ${context.root}\nfile ${rel}\ndependents`;
  if (edges.length === 0) return `${header}\nnone`;
  return [
    header,
    ...edges.map((edge) => `import\t${edge.from}\t${rel}\t${edge.specifier}`),
  ].join('\n');
}

module.exports = { fileDependentsTool: { definition, execute } };
