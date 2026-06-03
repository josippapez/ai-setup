'use strict';

const fs = require('node:fs');
const { resolveInsideRoot } = require('../lib/fs-utils.cjs');

function compactText(input) {
  const compacted = String(input || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .split(/\r?\n/g)
    .filter((line) => !line.trim().startsWith('!['))
    .join(' ')
    .replace(/[!`*_>#~|[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return compacted
    .split(/\s+/g)
    .filter((word) => !word.startsWith('http://') && !word.startsWith('https://'))
    .join(' ');
}

const definition = {
  name: 'read_doc',
  description:
    'Read one repository file by its repo-relative path and return its full text minified (markdown syntax, images, and URLs stripped; whitespace collapsed) to save tokens. Use after find_docs/list_docs to open a specific doc, or whenever you already know the path. Not limited to docs — any text file inside the repo root works, but files over 512 KiB are rejected and paths escaping the root are blocked. Returns the minified contents or a clear not-found/too-large error string.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Repo-root-relative path of the file to read (POSIX style, e.g. docs/guide.md). Required.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

function execute(args, context) {
  const relPath = String(args.path || '').trim();
  if (!relPath) return 'Please provide a non-empty path.';
  const absPath = resolveInsideRoot(context.root, relPath);
  if (!absPath) return 'Path is outside the repository root.';
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return `File not found: ${relPath}`;
  }
  if (!stat.isFile()) return `Not a regular file: ${relPath}`;
  if (stat.size > context.maxFileSizeBytes)
    return `File too large (${stat.size} bytes, max ${context.maxFileSizeBytes}): ${relPath}`;
  try {
    const content = fs.readFileSync(absPath, 'utf8');
    return compactText(content);
  } catch (err) {
    return `Read error: ${err.message}`;
  }
}

module.exports = { readDocTool: { definition, execute } };
