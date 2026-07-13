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
const SCHEMA_VERSION = 1;

function indexPath(context) { return path.join(context.root, '.claude', 'repo-docs', 'repo-docs-index.msp'); }

function ensureGitignore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
}

async function buildDocIndex(context) {
  const ready = await waitUntilReady();
  if (!ready) return { updated: 0, skipped: 0, cache: indexPath(context) };
  const db = await createIndex();
  let updated = 0, skipped = 0;
  for (const filePath of getDocFiles(context)) {
    let stat, content;
    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > Math.min(context.maxFileSizeBytes, MAX_FILE_BYTES)) { skipped++; continue; }
      content = fs.readFileSync(filePath, 'utf8');
    } catch { skipped++; continue; }
    const rel = relativePath(context.root, filePath);
    const records = [];
    for (const ch of chunkMarkdown(content)) {
      const embedding = await embedDocument(ch.text);
      if (!embedding) continue;
      records.push({ path: rel, heading: ch.headingPath, content: ch.text, startLine: ch.startLine, embedding });
    }
    if (records.length) { await addChunks(db, records); updated++; }
  }
  const dir = path.dirname(indexPath(context));
  ensureGitignore(dir);
  // Orphan the legacy per-file embedding cache from the old design.
  fs.rmSync(path.join(dir, 'interactive-mcp-doc-embeddings.json'), { force: true });
  fs.writeFileSync(path.join(dir, 'repo-docs-index.meta.json'), JSON.stringify({ model: MODEL_ID, dtype: MODEL_DTYPE, schemaVersion: SCHEMA_VERSION }));
  await saveIndex(db, indexPath(context));
  return { updated, skipped, cache: indexPath(context) };
}

module.exports = { buildDocIndex, indexPath };

if (require.main === module) {
  (async () => {
    const context = createContext(process.argv[2] || process.cwd());
    const r = await buildDocIndex(context);
    process.stdout.write(`repo_docs_index updated=${r.updated} skipped=${r.skipped} cache=${r.cache}\n`);
    await shutdown();
  })().catch((e) => { process.stderr.write(`repo_docs_index error: ${e.message}\n`); process.exit(1); });
}
