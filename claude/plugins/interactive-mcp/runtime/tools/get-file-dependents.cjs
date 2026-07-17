'use strict';

const { ensureDependencyIndex } = require('../lib/dependency-index.cjs');

const definition = {
  name: 'get_file_dependents',
  description:
    "List the direct (one-hop) importers of a JS/TS file from the prebuilt repo import graph — every source file that imports it. ALWAYS run this before you rename, move, delete, or change the exports/signature of a module: it is the fast, authoritative way to answer 'who imports this' / 'what breaks if I change this file', and it beats grep because it resolves both relative imports and tsconfig `paths` aliases (e.g. @scope/pkg) — alias importers a text search would miss are included. Input is a repo-relative path; returns one line per importing file with its import specifier, or 'none'. Bare third-party imports are not resolved. For transitive (multi-hop) impact, follow up with get_blast_radius.",
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

async function execute(args, context) {
  const rel = String(args.path || '').trim();
  if (!rel) return 'Please provide a non-empty path.';
  const index = await ensureDependencyIndex(context);
  const edges = index.dependentsByFile.get(rel) || [];
  const header = `repo ${context.root}\nfile ${rel}\ndependents`;
  if (edges.length === 0) return `${header}\nnone`;
  return [
    header,
    ...edges.map((edge) => `import\t${edge.from}\t${rel}\t${edge.specifier}`),
  ].join('\n');
}

module.exports = { fileDependentsTool: { definition, execute } };
