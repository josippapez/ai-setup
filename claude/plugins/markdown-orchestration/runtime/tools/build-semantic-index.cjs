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

function ensureGitignore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
}

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

async function buildDocIndex(context) {
  const ready = await waitUntilReady();
  if (!ready) return { updated: 0, unchanged: 0, skipped: 0, cache: indexPath(context) };
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
  fs.writeFileSync(metaPath(context), JSON.stringify({ model: MODEL_ID, dtype: MODEL_DTYPE, schemaVersion: SCHEMA_VERSION }));
  await saveIndex(db, indexPath(context));
  return { updated, unchanged, skipped, cache: indexPath(context) };
}

module.exports = { buildDocIndex, indexPath };

if (require.main === module) {
  (async () => {
    const context = createContext(process.argv[2] || process.cwd());
    const r = await buildDocIndex(context);
    process.stdout.write(`repo_docs_index updated=${r.updated} unchanged=${r.unchanged} skipped=${r.skipped} cache=${r.cache}\n`);
    await shutdown();
  })().catch((e) => { process.stderr.write(`repo_docs_index error: ${e.message}\n`); process.exit(1); });
}
