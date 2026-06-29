'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { clampInteger, tokenize } = require('../lib/fs-utils.cjs');

const definition = {
  name: 'find_libs',
  description:
    "Search the root package.json's dependencies and devDependencies by name and report the installed version range. Use when you need to know whether a package is present or what version is pinned — e.g. 'is zod installed', 'what version of react are we on', 'do we have a date library'. Returns matching entries as name@version with their kind (dependency|devDependency), ranked by name match. limit defaults to 20 (max 50). Reads only the repo-root package.json — workspace/package-level deps are not searched.",
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Package name or substring to match against dependency names. Required, non-empty.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        default: 20,
        description: 'Max matches to return; default 20, range 1-50.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

function execute(args, context) {
  const query = String(args.query || '').trim();
  const limit = clampInteger(args.limit, 20, 1, 50);
  if (!query) return 'Please provide a non-empty query.';
  let packageJson = {};
  try {
    packageJson = JSON.parse(
      fs.readFileSync(path.join(context.root, 'package.json'), 'utf8'),
    );
  } catch {
    return 'Unable to read package.json.';
  }
  const all = [
    ...Object.entries(packageJson.dependencies || {}).map(
      ([name, version]) => ({ name, version, kind: 'dependency' }),
    ),
    ...Object.entries(packageJson.devDependencies || {}).map(
      ([name, version]) => ({ name, version, kind: 'devDependency' }),
    ),
  ];
  const tokens = tokenize(query);
  const matches = [];
  for (const item of all) {
    const lowerName = item.name.toLowerCase();
    let score = lowerName.includes(query.toLowerCase()) ? 10 : 0;
    for (const token of tokens) if (lowerName.includes(token)) score += 4;
    if (score > 0) matches.push({ ...item, score });
  }
  if (matches.length === 0) return `No libs for "${query}".`;
  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return [
    `libs "${query}"`,
    ...matches
      .slice(0, limit)
      .map((item) => `${item.name}@${item.version} ${item.kind}`),
  ].join('; ');
}

module.exports = { findLibsTool: { definition, execute } };
