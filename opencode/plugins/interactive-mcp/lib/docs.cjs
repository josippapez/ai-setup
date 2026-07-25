'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { relativePath, walkDirectory } = require('./fs-utils.cjs');

const IGNORE_FILE = path.join('.opencode', 'repo-docs-ignore');
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
