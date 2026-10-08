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
    'Open one repository file by its repo-relative path. USE right after find_docs/list_docs to read a result, or whenever you already know the path — prefer this over answering from memory about this repo or reading a file blind. Not limited to docs — any text file inside the repo root works, but files over 512 KiB are rejected and paths escaping the root are blocked. Returns the raw contents by default, so the line numbers find_docs gives stay valid; pass compact:true for a minified read (markdown syntax, images, and URLs stripped; whitespace collapsed) that costs fewer tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Repo-root-relative path of the file to read (POSIX style, e.g. docs/guide.md). Required.',
      },
      compact: {
        type: 'boolean',
        default: false,
        description:
          'true returns a minified rendering (markdown syntax, images, and URLs stripped; whitespace collapsed) for fewer tokens. Default false returns the raw file.',
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
    return args.compact === true ? compactText(content) : content;
  } catch (err) {
    return `Read error: ${err.message}`;
  }
}

module.exports = { readDocTool: { definition, execute } };
