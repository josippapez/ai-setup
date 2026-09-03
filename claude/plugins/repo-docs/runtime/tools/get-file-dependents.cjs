'use strict';

const { ensureDependencyIndex } = require('../lib/dependency-index.cjs');

const definition = {
  name: 'get_file_dependents',
  description:
    "List the direct (one-hop) importers of a JS/TS file from the prebuilt repo import graph — every source file that imports it. ALWAYS run this before you rename, move, delete, or change the exports/signature of a module: it is the fast, authoritative way to answer 'who imports this' / 'what breaks if I change this file', and it beats grep because it resolves relative imports, tsconfig `paths` aliases and workspace-package names (e.g. @scope/pkg) — alias importers a text search would miss are included. Input is a repo-relative path; returns one line per importing file with its import specifier, or 'none'. Bare third-party imports are not resolved. THIS IS ONE HOP ONLY: 'none', or a result whose importers are all barrel/index files, does NOT mean the file is unused — real consumers usually import the package or barrel that re-exports it. Before concluding nothing uses a file, follow up with get_blast_radius and grep its exported symbol names.",
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

const BARREL_PATTERN = /(^|\/)index\.[cm]?[jt]sx?$/;

// One hop through a barrel hides the real consumers: they import the package or
// the index, not the leaf file. Say so explicitly rather than letting a short
// dependent list read as "nothing uses this".
function reachedOnlyThroughBarrels(edges) {
  return edges.length > 0 && edges.every((edge) => BARREL_PATTERN.test(edge.from));
}

async function execute(args, context) {
  const rel = String(args.path || '').trim();
  if (!rel) return 'Please provide a non-empty path.';
  const index = await ensureDependencyIndex(context);
  const edges = index.dependentsByFile.get(rel) || [];
  const header = `repo ${context.root}\nfile ${rel}\ndependents`;
  if (edges.length === 0)
    return `${header}\nnone\nnote\tOne hop only — 'none' is not proof the file is unused. Confirm with get_blast_radius and by grepping this file's exported symbol names before deleting or changing it.`;
  const lines = [
    header,
    ...edges.map((edge) => `import\t${edge.from}\t${rel}\t${edge.specifier}`),
  ];
  if (reachedOnlyThroughBarrels(edges))
    lines.push(
      "note\tEvery dependent above is a barrel/index file, so this is a re-export hop, not the real consumers — they import the barrel or its package. Re-run get_file_dependents on each barrel (or get_blast_radius on this path) and grep this file's exported symbol names before treating this list as the full impact.",
    );
  return lines.join('\n');
}

module.exports = { fileDependentsTool: { definition, execute } };
