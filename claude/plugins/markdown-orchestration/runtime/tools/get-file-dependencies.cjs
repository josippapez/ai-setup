'use strict';

const { ensureDependencyIndex } = require('../lib/dependency-index.cjs');

const definition = {
  name: 'get_file_dependencies',
  description:
    "List the outgoing imports/requires of a single JS/TS source file — i.e. what that file depends on. Use when tracing 'what does this module pull in' or before editing a file to see its imports. Input is a repo-relative path. Returns each edge as import|external + the source file + the resolved repo path (for relative imports) or the raw specifier (for package/alias imports, marked external). Relative-only resolution; bare and aliased imports stay unresolved. 'none' if the file has no imports or isn't in the graph.",
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
