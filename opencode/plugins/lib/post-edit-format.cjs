'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EDIT_TOOLS = new Set(['apply_patch', 'edit', 'create', 'write', 'multiedit', 'replace', 'insert']);
const PRETTIER_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.scss', '.html', '.yml', '.yaml',
]);
const ESLINT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function filesFromPatch(patchText) {
  const files = new Set();
  for (const pattern of [
    /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm,
    /^\+\+\+ b\/(.+)$/gm,
  ]) {
    let match = pattern.exec(String(patchText || ''));
    while (match) {
      files.add(match[1].trim());
      match = pattern.exec(String(patchText || ''));
    }
  }
  return files;
}

function collectEditedFiles(input) {
  const tool = String(input?.tool || '').toLowerCase();
  if (!EDIT_TOOLS.has(tool)) return [];
  const args = input.args || {};
  const files = new Set();
  for (const key of ['path', 'filePath', 'file_path', 'targetPath', 'target_path']) {
    if (typeof args[key] === 'string' && args[key].trim()) files.add(args[key].trim());
  }
  for (const key of ['patchText', 'patch', 'diff', 'input']) {
    for (const file of filesFromPatch(args[key])) files.add(file);
  }
  for (const value of [args.paths, args.files, args.edits, args.operations]) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === 'string') files.add(item);
      else if (item && typeof item === 'object') {
        const file = item.path || item.filePath || item.file_path;
        if (typeof file === 'string') files.add(file);
      }
    }
  }
  return [...files];
}

function findProjectRoot(startDirectory, binary) {
  let directory = startDirectory;
  while (true) {
    if (fs.existsSync(path.join(directory, 'node_modules', '.bin', binary))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function runLocal(binary, args, file) {
  const root = findProjectRoot(path.dirname(file), binary);
  if (!root) return;
  spawnSync(path.join(root, 'node_modules', '.bin', binary), [...args, file], {
    cwd: root,
    env: process.env,
    stdio: 'ignore',
  });
}

function formatEditedFiles(input, repositoryRoot) {
  for (const filePath of collectEditedFiles(input)) {
    const file = path.isAbsolute(filePath) ? filePath : path.resolve(repositoryRoot, filePath);
    if (!fs.existsSync(file)) continue;
    const extension = path.extname(file);
    if (PRETTIER_EXTENSIONS.has(extension)) runLocal('prettier', ['--write'], file);
    if (ESLINT_EXTENSIONS.has(extension)) runLocal('eslint', ['--fix', '--max-warnings=0'], file);
  }
}

module.exports = { collectEditedFiles, filesFromPatch, formatEditedFiles };
