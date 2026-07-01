'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { relativePath, walkDirectory } = require('./fs-utils.cjs');

// Optional per-repo ignore config: <repo>/.claude/repo-docs-ignore
// gitignore-lite, one pattern per line (# comments). A pattern without a slash
// matches at any depth; a trailing slash / bare dir name excludes the subtree;
// `*` matches within a path segment, `**` across segments.
const IGNORE_FILE = path.join('.claude', 'repo-docs-ignore');

// Non-character sentinel used to fold `**` before the single-`*` pass so it
// isn't re-processed. U+FFFF can't appear in a real path, so it never collides
// with the pattern; written as an escape to keep this source pure ASCII.
const GLOBSTAR = '\uFFFF';

function globToRegExp(pattern) {
  const clean = pattern.replace(/\/+$/, '');
  const hasSlash = clean.includes('/');
  const body = clean
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, GLOBSTAR)
    .replace(/\*/g, '[^/]*')
    .replaceAll(GLOBSTAR, '.*');
  return new RegExp(`${hasSlash ? '^' : '^(?:.*/)?'}${body}(?:/.*)?$`);
}

function loadIgnoreMatchers(root) {
  let lines;
  try {
    lines = fs.readFileSync(path.join(root, IGNORE_FILE), 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(globToRegExp);
}

// Index every Markdown file in the repo. walkDirectory already prunes the
// standard noise directories (node_modules, .git, dist, …) via SKIP_DIRS;
// the optional repo-docs-ignore config drops anything else the repo opts out of.
function getDocFiles(context) {
  const ignore = loadIgnoreMatchers(context.root);
  const files = [];
  walkDirectory(context.root, (filePath) => {
    const lower = filePath.toLowerCase();
    if (!lower.endsWith('.md') && !lower.endsWith('.mdx')) return;
    const rel = relativePath(context.root, filePath);
    if (ignore.some((matcher) => matcher.test(rel))) return;
    files.push(filePath);
  });
  return Array.from(new Set(files));
}

module.exports = { getDocFiles };
