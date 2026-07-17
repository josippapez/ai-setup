'use strict';

const { ensureDependencyIndex } = require('../lib/dependency-index.cjs');

const definition = {
  name: 'get_file_dependencies',
  description:
    "Map what a JS/TS file imports (its outgoing dependencies) from the prebuilt repo import graph. REACH FOR THIS instead of grepping imports by hand whenever you need to understand a file before editing it, trace what a module pulls in, or confirm a dependency exists — it is faster and more accurate than a text search. Input is a repo-relative path. Returns each edge as import|external + the source file + the resolved repo path (for relative or tsconfig-alias imports) or the raw specifier (for bare third-party imports, marked external). Resolves relative imports AND tsconfig `paths` aliases (e.g. @scope/pkg); only bare third-party imports stay external. 'none' if the file has no imports or isn't in the graph.",
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Repo-root-relative path of the source file to inspect (e.g. libs/web/foo/src/index.ts). Required.',
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
  const edges = index.dependenciesByFile.get(rel) || [];
  const header = `repo ${context.root}\nfile ${rel}\ndependencies`;
  if (edges.length === 0) return `${header}\nnone`;
  return [
    header,
    ...edges.map(
      (edge) =>
        `${edge.to ? 'import' : 'external'}\t${edge.from}\t${edge.to || edge.specifier}`,
    ),
  ].join('\n');
}

module.exports = { fileDependenciesTool: { definition, execute } };
