'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { clampInteger, tokenize } = require('../lib/fs-utils.cjs');

const definition = {
  name: 'find_libs',
  description:
    "Search the repo-root package.json's dependencies and devDependencies and report each match's declared version range and installed version. Each query word is matched on its own: as a substring of the package name, or as an exact keyword in the installed package's own package.json (so 'date' finds date-fns by name and dayjs by its keywords). Descriptions are not searched, so query with package names or one-word categories ('zod', 'react', 'date', 'http'), not sentences. Use when you need to know whether a package is declared and which version is installed. Returns one line per match, name matches weighted above keyword matches: name@declared-range, its kind (dependency|devDependency), then 'installed <version>' read from node_modules/<name>/package.json, or 'not in node_modules' when that file is missing; a package missing from node_modules is matched by name only. limit defaults to 20 (max 50). Reads only the repo-root package.json and node_modules — workspace/package-level deps are not searched.",
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          "Package names or one-word categories; each word is matched as a substring of dependency names and as an exact keyword of installed packages. Required, non-empty.",
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

// The installed package's own manifest: its version is what is actually on disk,
// where package.json only declares a range.
function installedManifest(root, name) {
  const modules = path.join(root, 'node_modules');
  const dir = path.join(modules, name);
  // Names come from the repo's package.json; a crafted one such as "../../x" must
  // not send the read outside node_modules.
  if (!dir.startsWith(`${modules}${path.sep}`)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null; // Not installed.
  }
}

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
    const manifest = installedManifest(context.root, item.name);
    const keywords = Array.isArray(manifest?.keywords)
      ? manifest.keywords.map((keyword) => String(keyword).toLowerCase())
      : [];
    let score = lowerName.includes(query.toLowerCase()) ? 10 : 0;
    for (const token of tokens) {
      if (lowerName.includes(token)) score += 4;
      else if (keywords.includes(token)) score += 2;
    }
    if (score > 0) matches.push({ ...item, installed: manifest?.version, score });
  }
  if (matches.length === 0) return `No libs for "${query}".`;
  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return [
    `libs "${query}"`,
    ...matches
      .slice(0, limit)
      .map(
        (item) =>
          `${item.name}@${item.version} ${item.kind} ${item.installed ? `installed ${item.installed}` : 'not in node_modules'}`,
      ),
  ].join('\n');
}

module.exports = { findLibsTool: { definition, execute } };
