'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { relativePath, walkDirectory } = require('./fs-utils.cjs');

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

// How many files to parse between yields to the event loop. Keeps the build
// non-blocking so get_repository_index_status can report live progress while
// indexing is in flight.
const YIELD_EVERY_FILES = 50;

function getSourceFiles(context) {
  const files = [];
  walkDirectory(context.root, (filePath) => {
    if (SOURCE_EXTENSIONS.has(path.extname(filePath))) files.push(filePath);
  });
  return files;
}

function resolveImportPath(context, fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...Array.from(SOURCE_EXTENSIONS, (ext) => `${base}${ext}`),
    ...Array.from(SOURCE_EXTENSIONS, (ext) => path.join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile())
        return relativePath(context.root, candidate);
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function parseDependencies(context, filePath) {
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const edges = [];
  const rel = relativePath(context.root, filePath);
  const matcher =
    /(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|require\s*\()\s*['"]([^'"]+)['"]/g;
  for (const match of content.matchAll(matcher)) {
    const specifier = match[1];
    edges.push({
      from: rel,
      specifier,
      to: resolveImportPath(context, filePath, specifier),
    });
  }
  return edges;
}

function indexState(context) {
  if (!context.dependencyIndexState) {
    context.dependencyIndexState = { status: 'idle', processed: 0, total: 0 };
  }
  return context.dependencyIndexState;
}

// Builds the dependency graph incrementally, updating progress on the context
// and yielding to the event loop so concurrent status calls observe live state.
async function buildDependencyIndex(context) {
  const state = indexState(context);
  const sourceFiles = getSourceFiles(context);
  state.status = 'building';
  state.processed = 0;
  state.total = sourceFiles.length;

  const dependenciesByFile = new Map();
  const dependentsByFile = new Map();
  let edgeCount = 0;

  for (let i = 0; i < sourceFiles.length; i += 1) {
    const filePath = sourceFiles[i];
    const rel = relativePath(context.root, filePath);
    const edges = parseDependencies(context, filePath);
    dependenciesByFile.set(rel, edges);
    edgeCount += edges.length;
    for (const edge of edges) {
      if (!edge.to) continue;
      if (!dependentsByFile.has(edge.to)) dependentsByFile.set(edge.to, []);
      dependentsByFile.get(edge.to).push(edge);
    }
    state.processed = i + 1;
    if ((i + 1) % YIELD_EVERY_FILES === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  context.dependencyIndex = {
    sourceFiles,
    dependenciesByFile,
    dependentsByFile,
    edgeCount,
  };
  state.status = 'ready';
  return context.dependencyIndex;
}

// Idempotent: kicks off the async build once and returns a promise resolving to
// the built index. Safe to call repeatedly (on connect, from the status tool,
// and from the dependency tools) — only the first call starts work.
function startDependencyIndex(context) {
  if (context.dependencyIndex) return Promise.resolve(context.dependencyIndex);
  if (context.dependencyIndexPromise) return context.dependencyIndexPromise;
  const promise = buildDependencyIndex(context).catch((err) => {
    indexState(context).status = 'error';
    context.dependencyIndexPromise = null;
    throw err;
  });
  context.dependencyIndexPromise = promise;
  return promise;
}

// Async accessor for the dependency tools — awaits the in-flight/started build.
function ensureDependencyIndex(context) {
  return startDependencyIndex(context);
}

// Snapshot of current build progress for the status tool (does not start work).
function getDependencyIndexState(context) {
  const state = indexState(context);
  return {
    status: state.status,
    processed: state.processed,
    total: state.total,
    index: context.dependencyIndex || null,
  };
}

module.exports = {
  startDependencyIndex,
  ensureDependencyIndex,
  getDependencyIndexState,
};
