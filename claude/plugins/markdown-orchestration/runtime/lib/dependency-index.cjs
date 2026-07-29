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

// Names of tsconfig files to look at for `compilerOptions.paths`, in priority
// order. Nx repos keep the alias map in tsconfig.base.json.
const TSCONFIG_CANDIDATES = ['tsconfig.base.json', 'tsconfig.json'];

// Minimal JSONC parser: strips // line and /* */ block comments (respecting
// double-quoted strings) plus trailing commas, then JSON.parse. tsconfig files
// commonly carry comments, so a plain JSON.parse would throw on them.
function parseJsonc(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (char === '\n') {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === '*' && next === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// Turns a `compilerOptions.paths` map into ordered match entries. TypeScript
// resolves the most specific pattern first, so exact keys are tried before
// wildcards, and wildcards by longest static prefix.
function buildAliasEntries(paths) {
  const entries = [];
  for (const [key, rawTargets] of Object.entries(paths || {})) {
    const targets = Array.isArray(rawTargets) ? rawTargets : [rawTargets];
    const starIndex = key.indexOf('*');
    if (starIndex === -1) {
      entries.push({ wildcard: false, key, prefix: key, suffix: '', targets });
      continue;
    }
    entries.push({
      wildcard: true,
      prefix: key.slice(0, starIndex),
      suffix: key.slice(starIndex + 1),
      targets,
    });
  }
  entries.sort((a, b) => {
    if (a.wildcard !== b.wildcard) return a.wildcard ? 1 : -1;
    return b.prefix.length - a.prefix.length;
  });
  return entries;
}

// Reads the repo's tsconfig alias map once and caches it on the context, so
// package-alias imports (e.g. "@scope/pkg") resolve to real files instead of
// being dropped as external. Falls back to no aliases (relative-only) when no
// tsconfig or paths map is present.
function loadAliasConfig(context) {
  if (context.aliasConfig) return context.aliasConfig;
  const config = { baseUrl: context.root, entries: [] };
  for (const name of TSCONFIG_CANDIDATES) {
    const file = path.join(context.root, name);
    let raw = '';
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    try {
      const options = parseJsonc(raw).compilerOptions || {};
      config.baseUrl = path.resolve(context.root, options.baseUrl || '.');
      config.entries = buildAliasEntries(options.paths);
    } catch {
      // Unparseable tsconfig — leave aliases empty (relative-only resolution).
    }
    break;
  }
  context.aliasConfig = config;
  return config;
}

// Resolves a bare specifier (module target) that already points at an absolute
// filesystem base to the first existing source file — trying the path as-is,
// then with each source extension, then as a directory index.
function resolveFileTarget(context, base) {
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

// Resolves a package-alias specifier via the tsconfig paths map. Returns the
// repo-relative file it points at, or null for bare third-party imports that
// match no alias.
function resolveAlias(context, specifier) {
  const { baseUrl, entries } = loadAliasConfig(context);
  for (const entry of entries) {
    if (!entry.wildcard) {
      if (entry.key !== specifier) continue;
      for (const target of entry.targets) {
        const hit = resolveFileTarget(context, path.resolve(baseUrl, target));
        if (hit) return hit;
      }
      continue;
    }
    if (specifier.length < entry.prefix.length + entry.suffix.length) continue;
    if (!specifier.startsWith(entry.prefix)) continue;
    if (!specifier.endsWith(entry.suffix)) continue;
    const captured = specifier.slice(
      entry.prefix.length,
      specifier.length - entry.suffix.length,
    );
    for (const target of entry.targets) {
      const hit = resolveFileTarget(
        context,
        path.resolve(baseUrl, target.replace('*', captured)),
      );
      if (hit) return hit;
    }
  }
  return null;
}

// Maps every in-repo package.json `name` to its directory. Workspace packages
// are imported by name (e.g. "@scope/web-lib") and resolved by the package
// manager through node_modules symlinks, not through tsconfig `paths` — without
// this map those importers look like bare third-party imports and vanish from
// the graph, which silently understates a file's dependents.
function loadWorkspacePackages(context) {
  if (context.workspacePackages) return context.workspacePackages;
  const packages = new Map();
  walkDirectory(context.root, (filePath) => {
    if (path.basename(filePath) !== 'package.json') return;
    try {
      const name = JSON.parse(fs.readFileSync(filePath, 'utf8')).name;
      if (typeof name === 'string' && name && !packages.has(name))
        packages.set(name, path.dirname(filePath));
    } catch {
      // Unreadable/unparseable package.json — skip it.
    }
  });
  context.workspacePackages = packages;
  return packages;
}

// Resolves a workspace-package specifier to a source file: either the package
// root ("@scope/pkg" -> its entry) or a subpath ("@scope/pkg/format").
// Source-shaped entries are preferred over built output so the graph points at
// files an edit would actually touch.
function resolveWorkspacePackage(context, specifier) {
  const packages = loadWorkspacePackages(context);
  for (const [name, dir] of packages) {
    if (specifier !== name && !specifier.startsWith(`${name}/`)) continue;
    if (specifier !== name) {
      const subpath = specifier.slice(name.length + 1);
      return (
        resolveFileTarget(context, path.resolve(dir, subpath)) ||
        resolveFileTarget(context, path.resolve(dir, 'src', subpath))
      );
    }
    let manifest = {};
    try {
      manifest = JSON.parse(
        fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
      );
    } catch {
      // Already logged as unusable above; fall back to conventions.
    }
    const candidates = [
      manifest.source,
      'src/index',
      'index',
      manifest.types,
      manifest.module,
      manifest.main,
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !candidate) continue;
      const hit = resolveFileTarget(context, path.resolve(dir, candidate));
      if (hit) return hit;
    }
    return null;
  }
  return null;
}

function resolveImportPath(context, fromFile, specifier) {
  if (specifier.startsWith('.'))
    return resolveFileTarget(
      context,
      path.resolve(path.dirname(fromFile), specifier),
    );
  return (
    resolveAlias(context, specifier) ||
    resolveWorkspacePackage(context, specifier)
  );
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
    context.dependencyIndexState = {
      status: 'idle',
      processed: 0,
      total: 0,
      generation: 0,
    };
  }
  return context.dependencyIndexState;
}

// Drops the cached graph so the next dependency-tool call rebuilds it against
// current sources (e.g. after a source-file edit mid-session). The generation
// bump makes any in-flight build finish as a no-op instead of committing a
// stale graph over the fresh one.
function invalidateDependencyIndex(context) {
  const state = indexState(context);
  state.generation = (state.generation || 0) + 1;
  state.status = 'idle';
  state.processed = 0;
  state.total = 0;
  context.dependencyIndex = null;
  context.dependencyIndexPromise = null;
}

// Builds the dependency graph incrementally, updating progress on the context
// and yielding to the event loop so concurrent status calls observe live state.
async function buildDependencyIndex(context) {
  const state = indexState(context);
  // Snapshot the generation: an invalidation while this build is in flight
  // bumps it, and a superseded build must not commit (or report progress for)
  // a graph that predates the invalidating edit.
  const generation = state.generation || 0;
  const isCurrent = () => (state.generation || 0) === generation;
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
    if (isCurrent()) state.processed = i + 1;
    if ((i + 1) % YIELD_EVERY_FILES === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  const index = {
    sourceFiles,
    dependenciesByFile,
    dependentsByFile,
    edgeCount,
  };
  if (isCurrent()) {
    context.dependencyIndex = index;
    state.status = 'ready';
  }
  // Superseded or not, return a coherent snapshot to callers already awaiting
  // this build; the next ensureDependencyIndex call gets the fresh graph.
  return index;
}

// Idempotent: kicks off the async build once and returns a promise resolving to
// the built index. Safe to call repeatedly (on connect, from the status tool,
// and from the dependency tools) — only the first call starts work.
function startDependencyIndex(context) {
  if (context.dependencyIndex) return Promise.resolve(context.dependencyIndex);
  if (context.dependencyIndexPromise) return context.dependencyIndexPromise;
  const generation = indexState(context).generation || 0;
  const promise = buildDependencyIndex(context).catch((err) => {
    // Only report/clear if this build wasn't superseded — a failing stale
    // build must not mark the fresh generation as errored or null its promise.
    if ((indexState(context).generation || 0) === generation) {
      indexState(context).status = 'error';
      context.dependencyIndexPromise = null;
    }
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
  invalidateDependencyIndex,
};
