'use strict';

const { ensureDependencyIndex } = require('../lib/dependency-index.cjs');
const { clampInteger } = require('../lib/fs-utils.cjs');

const definition = {
  name: 'get_blast_radius',
  description:
    "Compute the transitive dependents (the 'blast radius') of one or more files via breadth-first traversal of the prebuilt repo import graph — every file that directly OR indirectly imports the given paths. RUN THIS before any non-trivial refactor, move, rename, deletion, or public-API/signature change to size the full impact up front — it is the authoritative impact check and resolves relative imports, tsconfig `paths` aliases and workspace-package names (e.g. @scope/pkg), so alias importers grep would miss are included; only bare third-party imports stay external. Use this rather than get_file_dependents whenever the file sits behind a barrel/index: consumers import the package, so a one-hop query stops at the re-export. File-level reach is still not symbol-level use — before deleting anything, grep its exported symbol names across the files reported here. paths is required (>=1 repo-relative path). maxDepth defaults to 3 (0-10), limit caps total nodes at 60 (max 200). Returns each reached file tagged with its distance (d1, d2...) and the 'via' file it was reached through. A truncated result (hitting the node limit) is not proof of a small blast radius — raise limit/maxDepth to be sure.",
  inputSchema: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description:
          'One or more repo-root-relative file paths to seed the impact analysis from. Required, at least one.',
      },
      maxDepth: {
        type: 'integer',
        minimum: 0,
        maximum: 10,
        default: 3,
        description:
          'How many import hops to traverse outward; default 3, range 0-10.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 200,
        default: 60,
        description:
          'Max total nodes to return (BFS stops when reached); default 60, range 1-200.',
      },
    },
    required: ['paths'],
    additionalProperties: false,
  },
};

async function execute(args, context) {
  const roots = Array.isArray(args.paths) ? args.paths.map(String) : [];
  const maxDepth = clampInteger(args.maxDepth, 3, 0, 10);
  const limit = clampInteger(args.limit, 60, 1, 200);
  if (roots.length === 0) return 'Please provide at least one path.';
  const index = await ensureDependencyIndex(context);
  const queue = roots.map((item) => ({ path: item, distance: 0, via: null }));
  const seen = new Map();
  for (const item of queue) seen.set(item.path, item);
  for (
    let cursor = 0;
    cursor < queue.length && queue.length < limit;
    cursor += 1
  ) {
    const current = queue[cursor];
    if (current.distance >= maxDepth) continue;
    for (const edge of index.dependentsByFile.get(current.path) || []) {
      if (seen.has(edge.from)) continue;
      const next = {
        path: edge.from,
        distance: current.distance + 1,
        via: current.path,
      };
      seen.set(next.path, next);
      queue.push(next);
      if (queue.length >= limit) break;
    }
  }
  const lines = [
    `repo ${context.root}`,
    `roots ${roots.join(',')}`,
    `maxDepth ${maxDepth}`,
  ];
  for (const item of queue)
    lines.push(
      `d${item.distance}\t${item.path}${item.via ? `\tvia ${item.via}` : ''}`,
    );
  return lines.join('\n');
}

module.exports = { blastRadiusTool: { definition, execute } };
