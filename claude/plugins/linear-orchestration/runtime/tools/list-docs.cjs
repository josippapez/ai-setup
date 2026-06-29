'use strict';

const { getDocFiles } = require('../lib/docs.cjs');
const { clampInteger, relativePath } = require('../lib/fs-utils.cjs');

const definition = {
  name: 'list_docs',
  description:
    "Enumerate the repository's documentation files as relative paths, sorted alphabetically. Use when you want to browse what docs exist rather than search by topic — e.g. 'list the docs', 'what READMEs are in this repo'. source filters the set: 'all' (default), 'docs_only' (docs/ tree), or 'readmes_only'. Paginated via limit (default 200, max 5000) and offset; the result includes a count header and a next_offset when more remain.",
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['all', 'docs_only', 'readmes_only'],
        default: 'all',
        description:
          "Which files to list: 'all' (default), 'docs_only' (docs/ only), or 'readmes_only' (README files only).",
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 5000,
        default: 200,
        description: 'Max paths per page; default 200, range 1-5000.',
      },
      offset: {
        type: 'integer',
        minimum: 0,
        default: 0,
        description:
          'Zero-based start index for pagination; default 0. Use the returned next_offset to page.',
      },
    },
    additionalProperties: false,
  },
};

function execute(args, context) {
  const source = String(args.source || 'all');
  const limit = clampInteger(args.limit, 200, 1, 5000);
  const offset = clampInteger(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!['all', 'docs_only', 'readmes_only'].includes(source))
    return 'Invalid source. Use one of: all, docs_only, readmes_only.';

  let paths = getDocFiles(context).map((filePath) =>
    relativePath(context.root, filePath),
  );
  if (source === 'docs_only')
    paths = paths.filter((item) => item.startsWith('docs/'));
  if (source === 'readmes_only')
    paths = paths.filter(
      (item) =>
        item.toLowerCase().endsWith('/readme.md') || item === 'README.md',
    );
  paths.sort((a, b) => a.localeCompare(b));
  if (paths.length === 0) return `No docs for source=${source}.`;
  if (offset >= paths.length)
    return `offset ${offset} out of range; total=${paths.length}`;

  const page = paths.slice(offset, offset + limit);
  const parts = [`docs ${offset + 1}-${offset + page.length}/${paths.length}`];
  page.forEach((item, index) => parts.push(`${offset + index + 1}) ${item}`));
  if (offset + page.length < paths.length)
    parts.push(`next_offset=${offset + page.length}`);
  return parts.join('; ');
}

module.exports = { listDocsTool: { definition, execute } };
