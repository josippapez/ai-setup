'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createContext } = require('../lib/context.cjs');
const { getDocFiles } = require('../lib/docs.cjs');
const { relativePath } = require('../lib/fs-utils.cjs');
const { chunkMarkdown } = require('../lib/chunker.cjs');
const { waitUntilReady, embedDocument, shutdown, MODEL_ID, MODEL_DTYPE } = require('../lib/semantic-index.cjs');
const { createIndex, addChunks, saveIndex } = require('../lib/doc-index.cjs');

const MAX_FILE_BYTES = 1_000_000;
// Bumped 1 -> 2 for the mtime-cache field added to index records: a pre-v2
// (mtime-less) index fails the meta check below and triggers a clean full rebuild.
const SCHEMA_VERSION = 2;

function indexPath(context) { return path.join(context.root, '.claude', 'repo-docs', 'repo-docs-index.json'); }
function metaPath(context) { return path.join(path.dirname(indexPath(context)), 'repo-docs-index.meta.json'); }
function lockPath(context) { return path.join(path.dirname(indexPath(context)), 'index-build.lock'); }
function stampPath(context) { return path.join(path.dirname(indexPath(context)), 'index-build.stamp'); }

// A build shouldn't outlast this; a lock older than it is treated as a crashed
// build and taken over. Comfortably above a full cold rebuild of this corpus.
const BUILD_LOCK_STALE_MS = 15 * 60 * 1000;
// Coalesce bursts of rebuild triggers (e.g. many reindex ops from rapid .md
// edits, or several sessions connecting at once) into at most one build per window.
const BUILD_DEBOUNCE_MS = 5000;

function ensureGitignore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
}

// Single-writer guard: only one process builds the shared index at a time. Each
// concurrent Claude Code session in this repo spawns its own repo-docs MCP server,
// so N sessions would otherwise write the same repo-docs-index.json concurrently.
// Exclusive create wins the lock; a stale lock (crashed build) is taken over.
function acquireBuildLock(context) {
  const lock = lockPath(context);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); return true; }
  catch {
    let stale = false;
    try { stale = Date.now() - fs.statSync(lock).mtimeMs > BUILD_LOCK_STALE_MS; }
    catch { stale = true; } // lock vanished between the failed create and here
    if (!stale) return false;
    try { fs.writeFileSync(lock, String(process.pid)); return true; } catch { return false; }
  }
}
function releaseBuildLock(context) { try { fs.rmSync(lockPath(context), { force: true }); } catch {} }
function recentlyBuilt(context) {
  try { return Date.now() - Number(fs.readFileSync(stampPath(context), 'utf8')) < BUILD_DEBOUNCE_MS; }
  catch { return false; }
}
function markBuilt(context) { try { fs.writeFileSync(stampPath(context), String(Date.now())); } catch {} }

// Groups the prior persisted index's records by path, keyed to their mtime, so
// buildDocIndex can reuse cached chunks verbatim for files whose mtime hasn't
// changed. Reads the index's own persisted JSON directly (our format, not a
// public Orama API) rather than the loaded db object — see the json-vs-msgpack
// comment in doc-index.cjs for why JSON is safe to parse this way.
function loadPriorCache(context) {
  const byPath = new Map();
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath(context), 'utf8'));
    if (meta.schemaVersion !== SCHEMA_VERSION) return byPath;
  } catch {
    return byPath;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(indexPath(context), 'utf8'));
  } catch {
    return byPath;
  }
  const docs = raw && raw.docs && raw.docs.docs;
  if (!docs) return byPath;
  for (const rec of Object.values(docs)) {
    if (!rec || typeof rec.mtime !== 'number' || typeof rec.path !== 'string') continue;
    let group = byPath.get(rec.path);
    if (!group) { group = { mtime: rec.mtime, records: [] }; byPath.set(rec.path, group); }
    // A path's records should all share one mtime (written together per build).
    // If they don't (corrupt/foreign index), force a rebuild for that path.
    if (group.mtime !== rec.mtime) group.mtime = NaN;
    group.records.push(rec);
  }
  return byPath;
}

// force=true bypasses the debounce (manual /reindex should always rebuild); it
// still respects the single-writer lock so it never races an in-progress build.
async function buildDocIndex(context, { force = false } = {}) {
  const ready = await waitUntilReady();
  if (!ready) return { updated: 0, unchanged: 0, skipped: 0, cache: indexPath(context) };
  ensureGitignore(path.dirname(indexPath(context))); // dir must exist for the lock
  if (!force && recentlyBuilt(context)) {
    return { updated: 0, unchanged: 0, skipped: 0, cache: indexPath(context), debounced: true };
  }
  if (!acquireBuildLock(context)) {
    return { updated: 0, unchanged: 0, skipped: 0, cache: indexPath(context), locked: true };
  }
  try {
    return await runBuild(context);
  } finally {
    markBuilt(context);
    releaseBuildLock(context);
  }
}

async function runBuild(context) {
  const db = await createIndex();
  const priorCache = loadPriorCache(context);
  let updated = 0, unchanged = 0, skipped = 0;
  for (const filePath of getDocFiles(context)) {
    let stat;
    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > Math.min(context.maxFileSizeBytes, MAX_FILE_BYTES)) { skipped++; continue; }
    } catch { skipped++; continue; }
    const rel = relativePath(context.root, filePath);
    const prior = priorCache.get(rel);
    if (prior && prior.mtime === stat.mtimeMs) {
      await addChunks(db, prior.records);
      unchanged++;
      continue;
    }
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch { skipped++; continue; }
    const records = [];
    for (const ch of chunkMarkdown(content)) {
      const embedding = await embedDocument(ch.text);
      if (!embedding) continue;
      records.push({ path: rel, heading: ch.headingPath, content: ch.text, startLine: ch.startLine, embedding, mtime: stat.mtimeMs });
    }
    if (records.length) { await addChunks(db, records); updated++; }
  }
  const dir = path.dirname(indexPath(context));
  ensureGitignore(dir);
  // Orphan the legacy per-file embedding cache from the old design.
  fs.rmSync(path.join(dir, 'interactive-mcp-doc-embeddings.json'), { force: true });
  // Drop the stale binary index from before the json-persist fix.
  fs.rmSync(path.join(dir, 'repo-docs-index.msp'), { force: true });
  // Write the index (atomic rename) FIRST, then the meta. A reader that sees
  // schemaVersion===current in meta is then guaranteed a complete matching index.
  await saveIndex(db, indexPath(context));
  fs.writeFileSync(metaPath(context), JSON.stringify({ model: MODEL_ID, dtype: MODEL_DTYPE, schemaVersion: SCHEMA_VERSION }));
  return { updated, unchanged, skipped, cache: indexPath(context) };
}

module.exports = { buildDocIndex, indexPath };

if (require.main === module) {
  (async () => {
    const context = createContext(process.argv[2] || process.cwd());
    const r = await buildDocIndex(context, { force: true }); // manual run always rebuilds
    const note = r.locked ? ' (skipped: another build in progress)' : '';
    process.stdout.write(`repo_docs_index updated=${r.updated} unchanged=${r.unchanged} skipped=${r.skipped} cache=${r.cache}${note}\n`);
    await shutdown();
  })().catch((e) => { process.stderr.write(`repo_docs_index error: ${e.message}\n`); process.exit(1); });
}
