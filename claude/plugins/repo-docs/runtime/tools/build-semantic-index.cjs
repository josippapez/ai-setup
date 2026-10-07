'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { createContext } = require('../lib/context.cjs');
const { getDocFiles } = require('../lib/docs.cjs');
const { relativePath } = require('../lib/fs-utils.cjs');
const { waitUntilReady, embedDocsChunks, isReady, shutdown, MODEL_ID, MODEL_DTYPE } = require('../lib/semantic-index.cjs');
const { saveRecords, readRecords } = require('../lib/doc-index.cjs');

const MAX_FILE_BYTES = 1_000_000;
// Bumped 1 -> 2 for the mtime-cache field added to index records: a pre-v2
// (mtime-less) index fails the meta check below and triggers a clean full rebuild.
// Bumped 2 -> 3 for the chunker's fenced-code-block heading fix: a pre-v3 index
// may hold chunks split on a `#` comment inside a fence, so it's rebuilt too.
// Bumped 3 -> 4 when chunks started being sized by model tokens: a pre-v4 index
// may hold chunks whose tail past 512 tokens never made it into their vector.
// Bumped 4 -> 5 for the second, context-prefixed vector per chunk (ctxEmbedding).
// Bumped 5 -> 6 so each chunk records the line its own text starts on.
// Bumped 6 -> 7 when the index became one line per record with packed vectors,
// and the embedder moved to 8-bit weights.
const SCHEMA_VERSION = 7;

function indexPath(context) { return path.join(context.root, '.claude', 'repo-docs', 'repo-docs-index.json'); }
function metaPath(context) { return path.join(path.dirname(indexPath(context)), 'repo-docs-index.meta.json'); }
function lockPath(context) { return path.join(path.dirname(indexPath(context)), 'index-build.lock'); }
function stampPath(context) { return path.join(path.dirname(indexPath(context)), 'index-build.stamp'); }
// "<done> <total>" while a build runs, for the status-line mod; removed with the lock.
function headPath(context) { return path.join(path.dirname(indexPath(context)), 'index-build.head'); }
function progressPath(context) { return path.join(path.dirname(indexPath(context)), 'index-build.progress'); }

// A build shouldn't outlast this; a lock older than it is treated as a crashed
// build and taken over. Comfortably above a full cold rebuild of this corpus.
const BUILD_LOCK_STALE_MS = 15 * 60 * 1000;
// Coalesce bursts of rebuild triggers (e.g. many reindex ops from rapid .md
// edits, or several sessions connecting at once) into at most one build per window.
const BUILD_DEBOUNCE_MS = 5000;
// Changed docs are embedded this many to a worker round, so their chunks fill
// model batches together instead of each small doc running a part-empty batch.
const DOCS_PER_ROUND = 32;

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
// saveRecords writes `<index>.tmp.<pid>` and renames it over the index; a server killed
// mid-write leaves that file behind. Only the lock holder writes, so any left now is dead.
function removeAbandonedTempFiles(context) {
  const dir = path.dirname(indexPath(context));
  const prefix = `${path.basename(indexPath(context))}.tmp.`;
  try {
    for (const name of fs.readdirSync(dir)) if (name.startsWith(prefix)) fs.rmSync(path.join(dir, name), { force: true });
  } catch {}
}
function markBuilt(context) { try { fs.writeFileSync(stampPath(context), String(Date.now())); } catch {} }

// The commit the docs were read at. A branch switch or pull changes the docs without
// any edit this plugin sees, and find_docs kept answering from the old branch.
function gitHead(context) {
  try { return execFileSync('git', ['-C', context.root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
function builtAtOtherHead(context) {
  const head = gitHead(context);
  if (!head) return false;
  try { return fs.readFileSync(headPath(context), 'utf8') !== head; } catch { return true; }
}

// Groups the prior index's records by path, keyed to their mtime, so buildDocIndex
// can reuse cached chunks verbatim for files whose mtime hasn't changed.
async function loadPriorCache(context) {
  const byPath = new Map();
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath(context), 'utf8'));
    if (meta.schemaVersion !== SCHEMA_VERSION) return byPath;
  } catch {
    return byPath;
  }
  const records = await readRecords(indexPath(context));
  if (!records) return byPath;
  for (const rec of records) {
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
  removeAbandonedTempFiles(context);
  const head = gitHead(context);
  try {
    const result = await runBuild(context);
    if (head) try { fs.writeFileSync(headPath(context), head); } catch {}
    return result;
  } finally {
    markBuilt(context);
    try { fs.rmSync(progressPath(context), { force: true }); } catch {}
    releaseBuildLock(context);
  }
}

async function runBuild(context) {
  const priorCache = await loadPriorCache(context);
  let updated = 0, unchanged = 0, skipped = 0;
  const files = getDocFiles(context);
  // One slot per file, in file order, so the index keeps the same record order
  // whichever files were re-embedded.
  const slots = files.map(() => []);
  const changed = [];
  for (const [i, filePath] of files.entries()) {
    let stat;
    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > Math.min(context.maxFileSizeBytes, MAX_FILE_BYTES)) { skipped++; continue; }
    } catch { skipped++; continue; }
    const rel = relativePath(context.root, filePath);
    const prior = priorCache.get(rel);
    if (prior && prior.mtime === stat.mtimeMs) {
      slots[i] = prior.records;
      unchanged++;
      continue;
    }
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch { skipped++; continue; }
    changed.push({ i, rel, content, mtime: stat.mtimeMs });
  }
  for (let start = 0; start < changed.length; start += DOCS_PER_ROUND) {
    try { fs.writeFileSync(progressPath(context), `${start} ${changed.length}`); } catch {}
    const round = changed.slice(start, start + DOCS_PER_ROUND);
    const results = await embedDocsChunks(round.map(d => ({ path: d.rel, text: d.content })));
    // A dead embedder means every remaining file would also come back null, so
    // abort instead of saving an index with those files missing but the build
    // looking complete — that partial state would never self-heal.
    if (!results && !isReady()) throw new Error('embedder is no longer ready mid-build');
    round.forEach((doc, k) => {
      const records = [];
      for (const ch of (results && results[k]) || []) {
        // A live worker skipping one bad chunk keeps today's behavior.
        if (!ch.vector) continue;
        records.push({ path: doc.rel, heading: ch.headingPath, content: ch.text, startLine: ch.startLine, embedding: ch.vector, ctxEmbedding: ch.ctxVector, mtime: doc.mtime });
      }
      if (records.length) { slots[doc.i] = records; updated++; }
    });
  }
  const all = slots.flat();
  const dir = path.dirname(indexPath(context));
  ensureGitignore(dir);
  // Orphan the legacy per-file embedding cache from the old design.
  fs.rmSync(path.join(dir, 'interactive-mcp-doc-embeddings.json'), { force: true });
  // Drop the stale binary index from before the json-persist fix.
  fs.rmSync(path.join(dir, 'repo-docs-index.msp'), { force: true });
  // Write the index (atomic rename) FIRST, then the meta. A reader that sees
  // schemaVersion===current in meta is then guaranteed a complete matching index.
  await saveRecords(all, indexPath(context));
  fs.writeFileSync(metaPath(context), JSON.stringify({ model: MODEL_ID, dtype: MODEL_DTYPE, schemaVersion: SCHEMA_VERSION }));
  return { updated, unchanged, skipped, cache: indexPath(context) };
}

module.exports = { buildDocIndex, indexPath, builtAtOtherHead };

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
