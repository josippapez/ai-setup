'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createContext } = require('../lib/context.cjs');
const { getDocFiles } = require('../lib/docs.cjs');
const { relativePath } = require('../lib/fs-utils.cjs');
const { waitUntilReady, embedDocChunks, isReady, shutdown, MODEL_ID, MODEL_DTYPE } = require('../lib/semantic-index.cjs');
const { createIndex, addChunks, saveIndex } = require('../lib/doc-index.cjs');

const MAX_FILE_BYTES = 1_000_000;
// Bumped 1 -> 2 for the mtime-cache field added to index records: a pre-v2
// (mtime-less) index fails the meta check below and triggers a clean full rebuild.
// Bumped 2 -> 3 for the chunker's fenced-code-block heading fix: a pre-v3 index
// may hold chunks split on a `#` comment inside a fence, so it's rebuilt too.
// Bumped 3 -> 4 when chunks started being sized by model tokens: a pre-v4 index
// may hold chunks whose tail past 512 tokens never made it into their vector.
// Bumped 4 -> 5 so each chunk records the line its own text starts on.
const SCHEMA_VERSION = 5;

// OpenCode-namespaced index location (claude uses .claude/repo-docs/).
function indexPath(context) { return path.join(context.root, '.opencode', 'repo-docs', 'repo-docs-index.json'); }
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

// A dead lock owner makes the lock stale immediately, so a server that exits
// mid-build (its finally never ran) doesn't block every other session for up to
// BUILD_LOCK_STALE_MS. process.kill(pid, 0) sends no signal: ESRCH means the pid
// is gone, EPERM means it exists but we can't signal it (still alive).
function isLockOwnerAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (err) { return err.code === 'EPERM'; }
}

// Single-writer guard: only one process builds the shared index at a time. Two
// byte-identical MCP servers (dev-core + orchestrate), times N
// sessions, otherwise write the same repo-docs-index.json concurrently. Exclusive
// create wins the lock; a stale lock (crashed build) is taken over.
function acquireBuildLock(context) {
  const lock = lockPath(context);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); return true; }
  catch {
    let stale = false;
    let owner = null;
    try {
      owner = fs.readFileSync(lock, 'utf8');
      const dead = !isLockOwnerAlive(parseInt(owner, 10));
      stale = dead || Date.now() - fs.statSync(lock).mtimeMs > BUILD_LOCK_STALE_MS;
    }
    catch { stale = true; } // lock vanished between the failed create and here
    if (!stale) return false;
    // Another server can find the same stale lock: only remove it while it is still that one.
    try { if (owner !== null && fs.readFileSync(lock, 'utf8') === owner) fs.rmSync(lock); } catch {}
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); return true; } catch { return false; }
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
  if (!ready) return { updated: 0, unchanged: 0, skipped: 0, cache: indexPath(context), unavailable: true };
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
    const chunks = await embedDocChunks(content);
    // A dead embedder means every remaining file would also come back null, so
    // abort instead of saving an index with those files missing but the build
    // looking complete — that partial state would never self-heal.
    if (!chunks && !isReady()) throw new Error('embedder is no longer ready mid-build');
    for (const ch of chunks || []) {
      // A live worker skipping one bad chunk keeps today's behavior.
      if (!ch.vector) continue;
      records.push({ path: rel, heading: ch.headingPath, content: ch.text, startLine: ch.startLine, embedding: ch.vector, mtime: stat.mtimeMs });
    }
    if (records.length) { await addChunks(db, records); updated++; }
  }
  const dir = path.dirname(indexPath(context));
  ensureGitignore(dir);
  // Orphan the legacy per-file embedding cache from the old OpenCode design
  // (it lived at .opencode/interactive-mcp-doc-embeddings.json, not under repo-docs/).
  fs.rmSync(path.join(context.root, '.opencode', 'interactive-mcp-doc-embeddings.json'), { force: true });
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
    if (r.unavailable) {
      process.stderr.write('repo_docs_index error: embedder unavailable (dependencies missing or still installing) — no index built\n');
      await shutdown();
      process.exit(1);
    }
    const note = r.locked ? ' (skipped: another build in progress)' : '';
    process.stdout.write(`repo_docs_index updated=${r.updated} unchanged=${r.unchanged} skipped=${r.skipped} cache=${r.cache}${note}\n`);
    await shutdown();
  })().catch((e) => { process.stderr.write(`repo_docs_index error: ${e.message}\n`); process.exit(1); });
}
