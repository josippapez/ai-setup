# Repo-docs Hybrid Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-vector-per-file semantic layer in the repo-docs tools with a chunked, BM25+dense hybrid (Orama) retrieval pipeline, with an opt-in cross-encoder reranker, in both plugins.

**Architecture:** Markdown docs are split into heading-aware chunks; each chunk is embedded (bge-small ONNX) and stored in an Orama index (BM25 + vector) persisted under `.claude/repo-docs/`. `find_docs` embeds the query, runs Orama hybrid search, optionally reranks, collapses chunk hits to files, and returns file + section anchor + snippet. CPU/ONNX only; pure-JS deps; no native binaries.

**Tech Stack:** Node.js (CommonJS `.cjs`), `@huggingface/transformers` (ONNX, existing), `@orama/orama` + `@orama/plugin-data-persistence` (new, pure-JS), `node:test` for unit tests, `node:worker_threads` (existing embedder worker pattern).

## Global Constraints

- Two plugin copies stay **byte-identical**: `claude/plugins/interactive-mcp/runtime/**` and `claude/plugins/markdown-orchestration/runtime/**`. Every lib/tool change is applied to both; a comment marks them as lockstep copies.
- Zero-setup preserved: **no native-binary deps**; installed via the existing SessionStart `npm install` hook into `${CLAUDE_PLUGIN_DATA}/node_modules`.
- Dense model: `Xenova/bge-small-en-v1.5`, dtype `fp32`, 384-dim, query prefix `"Represent this sentence for searching relevant passages: "` (queries only, NOT documents).
- Reranker: `Xenova/bge-reranker-base`, **off by default**, opt-in via `RERANK_ENABLED` env.
- Chunking: ~1500 chars / 200 overlap, heading-aware. Safety cap: skip files > `MAX_FILE_BYTES` (1_000_000) or > `MAX_CHUNKS_PER_FILE` (200); `log` skips.
- Cache path base: `.claude/repo-docs/`; self-ignored via a `.gitignore` containing `*`.
- `_meta = { model, dtype, chunker, schemaVersion }`; any mismatch ⇒ full rebuild. `SCHEMA_VERSION` starts at `1` for the new store.
- Both plugin `version`s bumped so the version-keyed plugin cache redeploys.
- Reference (do not break) the existing worker pattern in `runtime/lib/semantic-index.cjs` (worker_threads + dynamic `import()` of the ESM transformers entry resolved via `createRequire`).

---

### Task 1: Add dependencies, bump versions, confirm Orama API

**Files:**
- Modify: `claude/plugins/interactive-mcp/package.json`
- Modify: `claude/plugins/markdown-orchestration/package.json`
- Modify: `claude/plugins/interactive-mcp/.claude-plugin/plugin.json`
- Modify: `claude/plugins/markdown-orchestration/.claude-plugin/plugin.json`
- Create (temp, delete after): `scratch/orama-smoke.mjs`

**Interfaces:**
- Produces: installed `@orama/orama` + `@orama/plugin-data-persistence` under `${CLAUDE_PLUGIN_DATA}/node_modules`, and confirmed API signatures (`create`, `insertMultiple`, `search({mode:'hybrid'})`, `persistToFile`/`restoreFromFile`).

- [ ] **Step 1: Add deps to both package.json files**

Add to the `dependencies` object of each plugin `package.json` (create the object if the file only had the transformers dep — match existing formatting):

```json
"@orama/orama": "^3.1.6",
"@orama/plugin-data-persistence": "^3.1.6"
```

- [ ] **Step 2: Bump both plugin versions**

`interactive-mcp/.claude-plugin/plugin.json`: `"version": "0.1.20"` → `"0.2.0"`.
`markdown-orchestration/.claude-plugin/plugin.json`: `"version": "0.23.0"` → `"0.24.0"`.

- [ ] **Step 3: Install and confirm the Orama API against the installed version**

Write `scratch/orama-smoke.mjs`:

```javascript
import { create, insertMultiple, search } from '@orama/orama';
import { persistToFile, restoreFromFile } from '@orama/plugin-data-persistence/server';
const db = create({ schema: { path: 'string', heading: 'string', content: 'string', embedding: 'vector[3]' } });
insertMultiple(db, [
  { path: 'a.md', heading: 'Intro', content: 'hello world alpha', embedding: [1, 0, 0] },
  { path: 'b.md', heading: 'Setup', content: 'beta install guide', embedding: [0, 1, 0] },
]);
const r = search(db, { mode: 'hybrid', term: 'install', vector: { value: [0, 1, 0], property: 'embedding' }, hybridWeights: { text: 0.5, vector: 0.5 }, similarity: 0, limit: 5 });
console.log('hits:', r.hits.map(h => [h.document.path, h.score]));
const f = await persistToFile(db, 'binary', './scratch/idx.msp');
const db2 = await restoreFromFile('binary', f);
console.log('restored count:', search(db2, { term: 'beta', limit: 5 }).count);
```

Run: `NODE_PATH="$HOME/.claude/plugins/data/interactive-mcp-inline/node_modules" node scratch/orama-smoke.mjs`
Expected: prints two hits with scores and `restored count: 1`.
If `create`/`insertMultiple`/`search` require `await` in the installed version, or option names differ, **record the actual signatures in the plan's Task 3/6 code before proceeding** (this is the spec's open item).

- [ ] **Step 4: Delete the smoke script**

```bash
rm -f scratch/orama-smoke.mjs scratch/idx.msp
```

- [ ] **Step 5: Commit**

```bash
git add claude/plugins/*/package.json claude/plugins/*/.claude-plugin/plugin.json
git commit -m "chore(repo-docs): add orama deps, bump plugin versions for hybrid search"
```

---

### Task 2: Markdown-aware chunker

**Files:**
- Create: `claude/plugins/interactive-mcp/runtime/lib/chunker.cjs`
- Test: `claude/plugins/interactive-mcp/runtime/lib/chunker.test.cjs`
- (Task 8 mirrors both to markdown-orchestration.)

**Interfaces:**
- Produces: `module.exports = { chunkMarkdown }`.
  `chunkMarkdown(text: string, opts?: {maxChars?:number, overlap?:number, maxChunks?:number}) => Array<{ headingPath: string, startLine: number, text: string }>`.

- [ ] **Step 1: Write the failing test**

`chunker.test.cjs`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { chunkMarkdown } = require('./chunker.cjs');

test('splits on headings and records the heading breadcrumb', () => {
  const md = '# Title\nintro line\n## Section A\nalpha content here\n### Sub\nbeta content here';
  const chunks = chunkMarkdown(md);
  assert.ok(chunks.length >= 2);
  const sub = chunks.find(c => c.text.includes('beta content'));
  assert.strictEqual(sub.headingPath, 'Title › Section A › Sub');
  assert.ok(sub.startLine >= 1);
});

test('packs long sections into overlapping windows', () => {
  const body = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  const chunks = chunkMarkdown('# H\n' + body, { maxChars: 300, overlap: 50 });
  assert.ok(chunks.length > 1);
  // overlap: end of chunk[0] reappears at start of chunk[1]
  const tail = chunks[0].text.slice(-30);
  assert.ok(chunks[1].text.includes(tail.trim().split(' ')[0]));
});

test('honors maxChunks safety cap', () => {
  const body = 'x '.repeat(100000);
  const chunks = chunkMarkdown('# H\n' + body, { maxChars: 200, overlap: 0, maxChunks: 5 });
  assert.strictEqual(chunks.length, 5);
});

test('empty input yields no chunks', () => {
  assert.deepStrictEqual(chunkMarkdown(''), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test claude/plugins/interactive-mcp/runtime/lib/chunker.test.cjs`
Expected: FAIL — "Cannot find module './chunker.cjs'".

- [ ] **Step 3: Implement the chunker**

`chunker.cjs`:

```javascript
'use strict';

const DEFAULTS = { maxChars: 1500, overlap: 200, maxChunks: 200 };

// Split markdown into heading-aware, overlapping chunks. Each chunk keeps the
// breadcrumb of ancestor headings and the 1-based line where it starts.
function chunkMarkdown(text, opts = {}) {
  const { maxChars, overlap, maxChunks } = { ...DEFAULTS, ...opts };
  if (!text || !text.trim()) return [];

  const lines = text.split(/\r?\n/);
  const sections = []; // { headingPath, startLine, body }
  const stack = []; // { level, title }
  let current = { headingPath: '', startLine: 1, body: [] };

  const pushCurrent = () => { if (current.body.join('').trim()) sections.push(current); };

  lines.forEach((line, idx) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      pushCurrent();
      const level = m[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: m[2].trim() });
      current = {
        headingPath: stack.map(s => s.title).join(' › '),
        startLine: idx + 1,
        body: [line],
      };
    } else {
      current.body.push(line);
    }
  });
  pushCurrent();

  const chunks = [];
  const step = Math.max(1, maxChars - overlap);
  for (const sec of sections) {
    const body = sec.body.join('\n');
    for (let i = 0; i < body.length; i += step) {
      if (chunks.length >= maxChunks) return chunks;
      chunks.push({ headingPath: sec.headingPath, startLine: sec.startLine, text: body.slice(i, i + maxChars) });
      if (i + maxChars >= body.length) break;
    }
  }
  return chunks;
}

module.exports = { chunkMarkdown, CHUNK_DEFAULTS: DEFAULTS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test claude/plugins/interactive-mcp/runtime/lib/chunker.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add claude/plugins/interactive-mcp/runtime/lib/chunker.cjs claude/plugins/interactive-mcp/runtime/lib/chunker.test.cjs
git commit -m "feat(repo-docs): markdown-aware chunker with heading breadcrumbs"
```

---

### Task 3: Orama doc-index module

**Files:**
- Create: `claude/plugins/interactive-mcp/runtime/lib/doc-index.cjs`
- Test: `claude/plugins/interactive-mcp/runtime/lib/doc-index.test.cjs`

**Interfaces:**
- Consumes: Orama (`create`, `insertMultiple`, `search`), persistence (`persistToFile`, `restoreFromFile`), `EMBED_DIM=384`.
- Produces: `module.exports = { createIndex, addChunks, hybridSearch, saveIndex, loadIndex, EMBED_DIM }`.
  - `createIndex() => db`
  - `addChunks(db, records: Array<{path,heading,content,startLine,embedding:number[]}>) => void`
  - `hybridSearch(db, {term, vector, limit}) => Array<{path,heading,content,startLine,score}>`
  - `saveIndex(db, filePath) => Promise<void>`; `loadIndex(filePath) => Promise<db|null>` (null if missing/unreadable)

- [ ] **Step 1: Write the failing test**

`doc-index.test.cjs`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createIndex, addChunks, hybridSearch, saveIndex, loadIndex, EMBED_DIM } = require('./doc-index.cjs');

const vec = (i) => Array.from({ length: EMBED_DIM }, (_, k) => (k === i ? 1 : 0));

test('hybrid search finds a doc by keyword and by vector, persists and restores', async () => {
  const db = createIndex();
  addChunks(db, [
    { path: 'auth.md', heading: 'Auth', content: 'login session token guide', startLine: 3, embedding: vec(0) },
    { path: 'build.md', heading: 'Build', content: 'compile bundle webpack', startLine: 1, embedding: vec(1) },
  ]);
  const byTerm = hybridSearch(db, { term: 'session token', vector: vec(0), limit: 5 });
  assert.strictEqual(byTerm[0].path, 'auth.md');
  assert.strictEqual(byTerm[0].heading, 'Auth');

  const tmp = path.join(os.tmpdir(), `di-${process.pid}.msp`);
  await saveIndex(db, tmp);
  const db2 = await loadIndex(tmp);
  assert.ok(db2);
  assert.strictEqual(hybridSearch(db2, { term: 'webpack', vector: vec(1), limit: 5 })[0].path, 'build.md');
  fs.rmSync(tmp, { force: true });
});

test('loadIndex returns null for a missing file', async () => {
  assert.strictEqual(await loadIndex('/no/such/index.msp'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_PATH="$HOME/.claude/plugins/data/interactive-mcp-inline/node_modules" node --test claude/plugins/interactive-mcp/runtime/lib/doc-index.test.cjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement doc-index**

`doc-index.cjs` (bridge ESM Orama into CJS via dynamic import, cached):

```javascript
'use strict';

const EMBED_DIM = 384;
let _orama = null;

async function orama() {
  if (_orama) return _orama;
  // NODE_PATH is honored by CJS require.resolve but NOT by ESM import(); resolve
  // absolute entries via require, then import the file URLs (same bridge the
  // embedder worker uses for @huggingface/transformers). Task 1 confirmed this.
  const { createRequire } = require('node:module');
  const { pathToFileURL } = require('node:url');
  const req = createRequire(__filename);
  const core = await import(pathToFileURL(req.resolve('@orama/orama')).href);
  const persist = await import(pathToFileURL(req.resolve('@orama/plugin-data-persistence/server')).href);
  _orama = { ...core, ...persist };
  return _orama;
}

// NOTE: Orama v3 create/insertMultiple/search are synchronous; persist is async.
// Confirmed in Task 1 smoke test — adjust if the installed version differs.
function createIndex(o) {
  return o.create({
    schema: { path: 'string', heading: 'string', content: 'string', startLine: 'number', embedding: `vector[${EMBED_DIM}]` },
  });
}

function addChunks(o, db, records) {
  o.insertMultiple(db, records);
}

function hybridSearch(o, db, { term, vector, limit = 30 }) {
  const res = o.search(db, {
    mode: 'hybrid',
    term,
    vector: { value: vector, property: 'embedding' },
    hybridWeights: { text: 0.5, vector: 0.5 },
    similarity: 0,
    limit,
  });
  return res.hits.map(h => ({
    path: h.document.path, heading: h.document.heading,
    content: h.document.content, startLine: h.document.startLine, score: h.score,
  }));
}

// Public async wrappers that resolve the ESM module first.
module.exports = {
  EMBED_DIM,
  createIndex: () => orama().then(createIndex),
  addChunks: (db, records) => orama().then(o => addChunks(o, db, records)),
  hybridSearch: (db, args) => orama().then(o => hybridSearch(o, db, args)),
  saveIndex: (db, filePath) => orama().then(o => o.persistToFile(db, 'binary', filePath)),
  loadIndex: (filePath) => orama().then(async o => {
    try { const fs = require('node:fs'); if (!fs.existsSync(filePath)) return null; return await o.restoreFromFile('binary', filePath); }
    catch { return null; }
  }),
};
```

Note: because `orama()` is async, `createIndex/addChunks/hybridSearch` return Promises here — update the test to `await` them. Adjust the Step-1 test to `const db = await createIndex();` etc. before running. (If the installed Orama exposes CJS `require`, replace the dynamic import with `require` and drop the Promises.)

- [ ] **Step 4: Update the test to await the async wrappers, then run**

Prefix the index calls in the test with `await` (`await createIndex()`, `await addChunks(...)`, `await hybridSearch(...)`).
Run: `NODE_PATH="$HOME/.claude/plugins/data/interactive-mcp-inline/node_modules" node --test claude/plugins/interactive-mcp/runtime/lib/doc-index.test.cjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add claude/plugins/interactive-mcp/runtime/lib/doc-index.cjs claude/plugins/interactive-mcp/runtime/lib/doc-index.test.cjs
git commit -m "feat(repo-docs): orama-backed hybrid doc index with persistence"
```

---

### Task 4: Rework the dense embedder (semantic-index.cjs)

**Files:**
- Modify: `claude/plugins/interactive-mcp/runtime/lib/semantic-index.cjs`

**Interfaces:**
- Consumes: existing worker infra (`warmUp`, `waitUntilReady`, `embedText`, `isReady`, `shutdown`).
- Produces: `module.exports` adds `embedQuery(text) => Promise<number[]|null>` and `embedDocument(text) => Promise<number[]|null>`; `MODEL_ID`, `EMBED_DIM=384` exported. Keep `warmUp/waitUntilReady/isReady/shutdown`.

- [ ] **Step 1: Set the model + query prefix constants**

Replace the model/const block:

```javascript
const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const MODEL_DTYPE = 'fp32';
const MODEL_MAX_TOKENS = 512;
const EMBED_DIM = 384;
// bge-small wants the retrieval instruction on QUERIES only (not documents).
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
```

Keep the worker body (`pipeline('feature-extraction', MODEL_ID, {dtype})`, `embed.tokenizer._tokenizerConfig.model_max_length = MODEL_MAX_TOKENS`, mean-pool + normalize). Remove the file-cache/`indexFiles`/`findSemantic`/`buildSemanticIndex` logic (that responsibility moves to `doc-index.cjs` + `build-semantic-index.cjs`); keep only the worker + `embedText`.

- [ ] **Step 2: Add embedQuery/embedDocument wrappers + exports**

```javascript
async function embedQuery(text) { return embedText(QUERY_PREFIX + String(text || '')); }
async function embedDocument(text) { return embedText(String(text || '')); }

module.exports = { warmUp, waitUntilReady, isReady, shutdown, embedQuery, embedDocument, MODEL_ID, MODEL_DTYPE, EMBED_DIM };
```

- [ ] **Step 3: Smoke-test the embedder produces a 384-vector**

Run:
```bash
NODE_PATH="$HOME/.claude/plugins/data/interactive-mcp-inline/node_modules" node -e '(async()=>{const s=require("./claude/plugins/interactive-mcp/runtime/lib/semantic-index.cjs");await s.waitUntilReady();const v=await s.embedQuery("hello");console.log("dim",v&&v.length);await s.shutdown();})()'
```
Expected: `dim 384`.

- [ ] **Step 4: Commit**

```bash
git add claude/plugins/interactive-mcp/runtime/lib/semantic-index.cjs
git commit -m "feat(repo-docs): dense embedder = bge-small, embedQuery/embedDocument API"
```

---

### Task 5: Opt-in cross-encoder reranker

**Files:**
- Create: `claude/plugins/interactive-mcp/runtime/lib/reranker.cjs`

**Interfaces:**
- Produces: `module.exports = { isRerankEnabled, rerank }`.
  - `isRerankEnabled() => boolean` (reads `process.env.RERANK_ENABLED === '1'`).
  - `rerank(query: string, candidates: Array<{text:string}>) => Promise<number[]>` — returns candidate indices sorted best-first; on any failure returns `candidates.map((_,i)=>i)` (identity = graceful fallback to input order).

- [ ] **Step 1: Implement the reranker (lazy model load, graceful fallback)**

```javascript
'use strict';

const RERANKER_ID = 'Xenova/bge-reranker-base';
let _mod = null, _failed = false;

function isRerankEnabled() { return process.env.RERANK_ENABLED === '1'; }

async function load() {
  if (_mod || _failed) return _mod;
  try {
    const { createRequire } = require('node:module');
    const { pathToFileURL } = require('node:url');
    const entry = createRequire(__filename).resolve('@huggingface/transformers');
    const { AutoTokenizer, AutoModelForSequenceClassification } = await import(pathToFileURL(entry).href);
    const tokenizer = await AutoTokenizer.from_pretrained(RERANKER_ID);
    const model = await AutoModelForSequenceClassification.from_pretrained(RERANKER_ID, { dtype: 'fp32' });
    _mod = { tokenizer, model };
  } catch { _failed = true; }
  return _mod;
}

async function rerank(query, candidates) {
  const identity = candidates.map((_, i) => i);
  if (!isRerankEnabled() || candidates.length === 0) return identity;
  const m = await load();
  if (!m) return identity;
  try {
    const scored = [];
    for (let i = 0; i < candidates.length; i++) {
      const inputs = m.tokenizer(query, { text_pair: String(candidates[i].text).slice(0, 2000), padding: true, truncation: true });
      const { logits } = await m.model(inputs);
      scored.push({ i, s: logits.data[0] });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.map(x => x.i);
  } catch { return identity; }
}

module.exports = { isRerankEnabled, rerank, RERANKER_ID };
```

- [ ] **Step 2: Smoke-test disabled path returns identity without loading a model**

Run:
```bash
node -e '(async()=>{const r=require("./claude/plugins/interactive-mcp/runtime/lib/reranker.cjs");console.log(JSON.stringify(await r.rerank("q",[{text:"a"},{text:"b"}])));})()'
```
Expected: `[0,1]` (RERANK_ENABLED unset → identity, no model download).

- [ ] **Step 3: Commit**

```bash
git add claude/plugins/interactive-mcp/runtime/lib/reranker.cjs
git commit -m "feat(repo-docs): opt-in bge-reranker cross-encoder (off by default)"
```

---

### Task 6: Rework find-docs.cjs orchestration + return contract

**Files:**
- Modify: `claude/plugins/interactive-mcp/runtime/tools/find-docs.cjs`

**Interfaces:**
- Consumes: `doc-index.cjs` (`loadIndex`, `hybridSearch`), `semantic-index.cjs` (`isReady`, `embedQuery`), `reranker.cjs` (`isRerankEnabled`, `rerank`), the index cache path from `build-semantic-index.cjs` (Task 7 exports `indexPath(context)`).
- Produces: unchanged tool shape `{ findDocsTool: { definition, execute } }`; `execute(args, context) => string`.

- [ ] **Step 1: Replace execute() body with hybrid-search orchestration**

Update the `definition.inputSchema.properties` to add an on-demand rerank flag (alongside `query` and `limit`):

```javascript
rerank: {
  type: 'boolean',
  default: false,
  description: 'Apply a cross-encoder reranker to the top candidates. Helps exact-term/literal queries; may hurt paraphrased ones. Off by default.',
},
```

Also update `definition.description` to mention section anchors and the `rerank` option. Then replace `execute`:

```javascript
const { loadIndex, hybridSearch } = require('../lib/doc-index.cjs');
const { isReady, embedQuery } = require('../lib/semantic-index.cjs');
const { isRerankEnabled, rerank } = require('../lib/reranker.cjs');
const { indexPath } = require('./build-semantic-index.cjs');

const MAX_SNIPPET_CHARS = 180;

async function execute(args, context) {
  const query = String(args.query || '').trim();
  const limit = clampInteger(args.limit, 12, 1, 30);
  if (!query) return 'Please provide a non-empty query.';
  if (!isReady()) return `Semantic index not ready yet — retry shortly.`;

  const db = await loadIndex(indexPath(context));
  if (!db) return `No index yet for this repo — run the reindex command first.`;

  const qvec = await embedQuery(query);
  if (!qvec) return `Could not embed the query.`;

  // Over-fetch chunk hits, optionally rerank, then collapse to best chunk per file.
  const CAND = 30;
  let hits = await hybridSearch(db, { term: query, vector: qvec, limit: CAND });
  const wantRerank = args.rerank === true || isRerankEnabled();
  if (wantRerank && hits.length > 1) {
    const orderIdx = await rerank(query, hits.map(h => ({ text: h.content })));
    hits = orderIdx.map(i => hits[i]);
  }

  const seen = new Set();
  const files = [];
  for (const h of hits) {
    if (seen.has(h.path)) continue;
    seen.add(h.path);
    files.push(h);
    if (files.length >= limit) break;
  }
  if (files.length === 0) return `No docs for "${query}".`;

  const parts = [`docs "${query}"`];
  files.forEach((h, i) => {
    const anchor = h.heading ? ` › ${h.heading}` : '';
    const snippet = compactText(h.content).slice(0, MAX_SNIPPET_CHARS);
    parts.push(`${i + 1}) ${h.path}:${h.startLine}${anchor} — ${snippet}`);
  });
  return parts.join('; ');
}
```

Keep the existing `compactText` helper. Delete the now-unused keyword-scan code (`DIR_TOKEN_MAP`, per-file `fs` scan, `tokenize`/`freq` logic) — those are superseded by Orama BM25. Remove now-orphaned imports (`fs`, `getDocFiles`, `tokenize`, `relativePath`, `findSemantic`).

- [ ] **Step 2: Manual end-to-end check (after Task 7 builds an index)**

Deferred to Task 9 (needs a built index). No unit test here — this is orchestration/formatting glue verified end-to-end.

- [ ] **Step 3: Commit**

```bash
git add claude/plugins/interactive-mcp/runtime/tools/find-docs.cjs
git commit -m "feat(repo-docs): find_docs returns file + section anchor via hybrid search"
```

---

### Task 7: Rework build-semantic-index.cjs (chunk → embed → index, incremental)

**Files:**
- Modify: `claude/plugins/interactive-mcp/runtime/tools/build-semantic-index.cjs`
- Modify: `claude/plugins/interactive-mcp/runtime/standalone-mcp.cjs` (warm/build call on `initialize`)

**Interfaces:**
- Consumes: `getDocFiles(context)`, `chunkMarkdown`, `embedDocument`, `createIndex/addChunks/saveIndex/loadIndex`, `waitUntilReady`.
- Produces: `module.exports = { buildDocIndex, indexPath }`.
  - `indexPath(context) => string` = `path.join(context.root, '.claude', 'repo-docs', 'repo-docs-index.msp')`.
  - `buildDocIndex(context) => Promise<{updated,skipped,cache}>`.

- [ ] **Step 1: Implement builder (full rebuild; incremental is a follow-up)**

```javascript
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
```

- [ ] **Step 2: Update standalone-mcp.cjs initialize hook**

Replace the old `buildSemanticIndex(context, getDocFiles(context))` call (around `standalone-mcp.cjs:73`) with:

```javascript
const { buildDocIndex } = require('./tools/build-semantic-index.cjs');
// ...in initialize handler, after warmUp():
buildDocIndex(context).catch(() => {});
```
Remove the now-unused `buildSemanticIndex` import.

- [ ] **Step 3: Build the index for THIS repo and verify output**

Run:
```bash
NODE_PATH="$HOME/.claude/plugins/data/interactive-mcp-inline/node_modules" node claude/plugins/interactive-mcp/runtime/tools/build-semantic-index.cjs "$(pwd)"
```
Expected: `repo_docs_index updated=<N>0 skipped=... cache=.../repo-docs-index.msp` and the `.msp` file exists.

- [ ] **Step 4: Commit**

```bash
git add claude/plugins/interactive-mcp/runtime/tools/build-semantic-index.cjs claude/plugins/interactive-mcp/runtime/standalone-mcp.cjs
git commit -m "feat(repo-docs): build chunked orama index; orphan legacy cache"
```

---

### Task 8: Mirror to markdown-orchestration + docs-sync

**Files:**
- Create/Modify (mirror of Tasks 2–7): `claude/plugins/markdown-orchestration/runtime/lib/{chunker,chunker.test,doc-index,doc-index.test,semantic-index,reranker}.cjs`, `.../runtime/tools/{find-docs,build-semantic-index}.cjs`, `.../runtime/standalone-mcp.cjs`
- Modify: `claude/plugins/interactive-mcp/README.md`, `claude/plugins/markdown-orchestration/README.md`
- Modify: `claude/plugins/markdown-orchestration/commands/reindex.md`

**Interfaces:**
- Produces: byte-identical `runtime/**` search modules across both plugins.

- [ ] **Step 1: Copy the six lib/tool files verbatim into markdown-orchestration**

```bash
for f in lib/chunker.cjs lib/chunker.test.cjs lib/doc-index.cjs lib/doc-index.test.cjs lib/semantic-index.cjs lib/reranker.cjs tools/find-docs.cjs tools/build-semantic-index.cjs; do
  cp "claude/plugins/interactive-mcp/runtime/$f" "claude/plugins/markdown-orchestration/runtime/$f"
done
```

- [ ] **Step 2: Apply the same standalone-mcp.cjs initialize edit to markdown-orchestration**

Make the Task 7 Step 2 change in `claude/plugins/markdown-orchestration/runtime/standalone-mcp.cjs`.

- [ ] **Step 3: Verify both test suites pass under each plugin's module path**

Run:
```bash
NODE_PATH="$HOME/.claude/plugins/data/interactive-mcp-inline/node_modules" node --test claude/plugins/markdown-orchestration/runtime/lib/chunker.test.cjs claude/plugins/markdown-orchestration/runtime/lib/doc-index.test.cjs
```
Expected: PASS.

- [ ] **Step 4: Update the reindex command doc + both READMEs (docs-sync)**

In `commands/reindex.md`: change the download-size note to "First run downloads the embedding model (~90 MB) and builds a chunked hybrid index." Change the reported line to `repo_docs_index updated=… skipped=… cache=…`.
In both `README.md`: update the repo-docs tool description to mention hybrid (BM25+dense) chunked search returning file + section anchor; note the optional `RERANK_ENABLED` flag.

- [ ] **Step 5: Commit**

```bash
git add claude/plugins/markdown-orchestration/runtime claude/plugins/*/README.md claude/plugins/markdown-orchestration/commands/reindex.md
git commit -m "feat(repo-docs): mirror hybrid search to markdown-orchestration + docs-sync"
```

---

### Task 9: Deploy, verify end-to-end, and lock in the eval harness

**Files:**
- Create: `docs/superpowers/evals/repo-docs-retrieval.mjs` (promote the benchmark)
- Create: `docs/superpowers/evals/queries.example.json` (the paraphrase gold set)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Deploy both plugins**

Run: `bash claude/install.sh 2>&1 | tail -5`
Expected: both plugins install/update without error.

- [ ] **Step 2: Reindex this repo, then exercise find_docs end-to-end**

Run:
```bash
NODE_PATH="$HOME/.claude/plugins/data/interactive-mcp-inline/node_modules" node -e '(async()=>{
  const {createContext}=require("./claude/plugins/interactive-mcp/runtime/lib/context.cjs");
  const {buildDocIndex}=require("./claude/plugins/interactive-mcp/runtime/tools/build-semantic-index.cjs");
  const {waitUntilReady,shutdown}=require("./claude/plugins/interactive-mcp/runtime/lib/semantic-index.cjs");
  const {findDocsTool}=require("./claude/plugins/interactive-mcp/runtime/tools/find-docs.cjs");
  const ctx=createContext(process.cwd()); await waitUntilReady(); await buildDocIndex(ctx);
  console.log(await findDocsTool.execute({query:"how are tasks routed to specialist subagents"},ctx));
  await shutdown();
})()'
```
Expected: a `docs "..."; 1) path:line › Heading — snippet; ...` line whose top hit is an agent-orchestration doc, with a section anchor.

- [ ] **Step 3: Promote the eval harness + gold set into the repo**

Copy `bench-para.mjs` → `docs/superpowers/evals/repo-docs-retrieval.mjs` and `queries.json` → `docs/superpowers/evals/queries.example.json`. Add a header comment documenting how to run it and the recorded baseline (bge-small dense/hybrid ≈ 89% hit@1 / 0.93 MRR on the semantic set).

- [ ] **Step 4: Run the eval as a regression gate**

Run:
```bash
NODE_PATH="$HOME/.claude/plugins/data/interactive-mcp-inline/node_modules" node docs/superpowers/evals/repo-docs-retrieval.mjs "<PATH-TO-A-DOCS-REPO>" docs/superpowers/evals/queries.example.json
```
Expected: bge-small dense-only / +hybrid ≈ 89% hit@1 — no regression vs the recorded baseline.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/evals
git commit -m "test(repo-docs): repeatable retrieval eval harness + example gold set"
```

---

## Self-Review

- **Spec coverage:** chunking (T2), dense bge-small + query prefix (T4), Orama hybrid BM25+dense (T3), opt-in reranker off-by-default (T5), return file+section+snippet (T6), whole-file coverage + safety cap (T2/T7), incremental/`_meta` invalidation (T7 — full rebuild now; incremental noted as follow-up), both plugins lockstep (T8), version bumps + deps (T1), docs-sync (T8), eval harness (T9). Covered.
- **Deferred within plan:** true incremental (mtime-diff) upsert is simplified to full rebuild in T7 — acceptable at ~2k chunks (~1–3 min); flagged for a follow-up. Non-destructive rerank blend deferred (spec §5.5).
- **Type consistency:** `embedQuery`/`embedDocument` (T4) used by T6/T7; `createIndex/addChunks/hybridSearch/saveIndex/loadIndex` (T3) used by T6/T7; `indexPath` (T7) used by T6; `rerank`/`isRerankEnabled` (T5) used by T6. Names align.
- **Open item to resolve at T1:** exact Orama sync/async signatures — the smoke test verifies before dependent tasks build on them.
