# Proactive Doc-Context Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically surface the most relevant local docs to the agent — on each user prompt and as it works — by having the running MCP server host a fast local socket that ranks the query against the existing bge-small/Orama index, with hooks injecting the results via `hookSpecificOutput.additionalContext` only when a relevance threshold is cleared.

**Architecture:** The already-running `interactive-mcp` MCP server opens a Unix socket on `initialize` (reusing its warm embedder worker + loaded index — one model, no new process). Dependency-light `.mjs` hook scripts (`UserPromptSubmit`, `PostToolBatch`→`PostToolUse` fallback) connect to that socket, get ranked hits, and print a compact pointer block. Everything is opt-in, threshold-gated, deduped, and fail-safe (any error → inject nothing, never break the turn).

**Tech Stack:** Node.js (CommonJS runtime `.cjs` + ESM hooks `.mjs`), `node:net` Unix domain socket, `node:test`, existing engine libs (`lib/semantic-index.cjs`, `lib/doc-index.cjs`), `@orama/orama` + `@huggingface/transformers` (already installed for the engine).

## Global Constraints

- Runtime code is **plain CommonJS `.cjs`**; hook scripts are **ESM `.mjs`** and MUST stay dependency-free (only `node:` builtins) — they run as fresh processes and must not require the plugin's node_modules.
- The two claude runtime dirs (`claude/plugins/interactive-mcp/runtime`, `claude/plugins/markdown-orchestration/runtime`) MUST stay **byte-identical** for every runtime file touched — edit once, copy, `diff -r` to confirm.
- Feature is **opt-in**: nothing activates unless `REPO_DOCS_INJECT=1`. Default behavior of the plugin is unchanged.
- **Fail-safe:** every hook exits `0` and injects nothing on any error (socket absent, timeout, no index, malformed data). A hook MUST never block or fail a turn.
- Socket path is deterministic: `<repo-root>/.claude/repo-docs/inject.sock` (dir is already git-ignored).
- Injection payload MUST be compact: top `REPO_DOCS_INJECT_LIMIT` hits (default 3), each one line, snippet ≤ 180 chars.
- Do NOT read `.env` files.
- Tests run with: `NODE_PATH=/Users/josippapez/.claude/plugins/data/interactive-mcp-ai-setup/node_modules REPO_DOCS_MODELS_DIR=$HOME/.claude/repo-docs-models node --test <files>`.
- Reviewer subagents (if orchestrated) are sonnet/opus, never haiku.

---

### Task 1: Extract `rankDocs` shared ranking helper

DRY the ranking logic out of `find_docs` so the socket server and the tool share one code path. `find_docs.execute` currently embeds + hybrid-searches + collapses-to-one-per-file + formats a string; extract everything up to the formatting into `lib/doc-search.cjs`.

**Files:**
- Create: `claude/plugins/interactive-mcp/runtime/lib/doc-search.cjs`
- Modify: `claude/plugins/interactive-mcp/runtime/tools/find-docs.cjs` (use the helper)
- Test: `claude/plugins/interactive-mcp/runtime/lib/doc-search.test.cjs`
- Mirror all three to `claude/plugins/markdown-orchestration/runtime/…`

**Interfaces:**
- Produces: `rankDocs(context, { query, limit=12, threshold=0 }) : Promise<Array<{ path, heading, content, startLine, score }>>` — embeds the query, runs `hybridSearch` (CAND=60), collapses to best chunk per file, filters `score >= threshold`, caps to `limit`. Returns `[]` when the index is absent or the embedder isn't ready.
- Consumes: `loadIndex`, `hybridSearch` (`lib/doc-index.cjs`); `isReady`, `embedQuery` (`lib/semantic-index.cjs`); `indexPath` (`tools/build-semantic-index.cjs`).

- [ ] **Step 1: Write the failing test**

```javascript
// claude/plugins/interactive-mcp/runtime/lib/doc-search.test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { warmUp, waitUntilReady, embedDocument, shutdown } = require('./semantic-index.cjs');
const { createIndex, addChunks, saveIndex } = require('./doc-index.cjs');
const { rankDocs } = require('./doc-search.cjs');

test('rankDocs returns hits above threshold, collapsed one-per-file', async () => {
  warmUp();
  const ready = await waitUntilReady();
  assert.ok(ready, 'embedder must warm up');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docsearch-'));
  const root = dir;
  fs.mkdirSync(path.join(root, '.claude', 'repo-docs'), { recursive: true });
  const db = await createIndex();
  const text = '# Auth\nHow token refresh and login sessions work in this project.';
  const emb = await embedDocument(text);
  await addChunks(db, [{ path: 'docs/auth.md', heading: 'Auth', content: text, startLine: 1, mtime: 1, embedding: emb }]);
  await saveIndex(db, path.join(root, '.claude', 'repo-docs', 'repo-docs-index.json'));

  const context = { root, maxFileSizeBytes: 1e6 };
  const hits = await rankDocs(context, { query: 'how does login token refresh work', limit: 3, threshold: 0 });
  assert.ok(hits.length >= 1, 'expected at least one hit');
  assert.strictEqual(hits[0].path, 'docs/auth.md');
  assert.ok(typeof hits[0].score === 'number');
  await shutdown();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_PATH=/Users/josippapez/.claude/plugins/data/interactive-mcp-ai-setup/node_modules REPO_DOCS_MODELS_DIR=$HOME/.claude/repo-docs-models node --test claude/plugins/interactive-mcp/runtime/lib/doc-search.test.cjs`
Expected: FAIL — `Cannot find module './doc-search.cjs'`.

- [ ] **Step 3: Write `lib/doc-search.cjs`**

```javascript
'use strict';

const { loadIndex, hybridSearch } = require('./doc-index.cjs');
const { isReady, embedQuery } = require('./semantic-index.cjs');
const { indexPath } = require('../tools/build-semantic-index.cjs');

const CAND = 60;

// Shared ranking core for find_docs and the injection socket: embed the query,
// hybrid-search, collapse to the best chunk per file, filter by threshold, cap.
async function rankDocs(context, { query, limit = 12, threshold = 0 } = {}) {
  const q = String(query || '').trim();
  if (!q || !isReady()) return [];
  const db = await loadIndex(indexPath(context));
  if (!db) return [];
  const qvec = await embedQuery(q);
  if (!qvec) return [];

  const hits = await hybridSearch(db, { term: q, vector: qvec, limit: CAND });
  const seen = new Set();
  const files = [];
  for (const h of hits) {
    if (h.score < threshold) continue;
    if (seen.has(h.path)) continue;
    seen.add(h.path);
    files.push(h);
    if (files.length >= limit) break;
  }
  return files;
}

module.exports = { rankDocs, CAND };
```

- [ ] **Step 4: Refactor `find-docs.cjs` to use `rankDocs`**

In `tools/find-docs.cjs`, replace the inline embed + `hybridSearch` + collapse block inside `execute` with a call to `rankDocs`, preserving the existing rerank path and string formatting. Replace the body between the `if (!query)` guard and the results-formatting loop:

```javascript
// near the top, add:
const { rankDocs, CAND } = require('../lib/doc-search.cjs');

// inside execute(), replacing the qvec/hybridSearch/rerank/collapse block:
  if (!isReady()) return `Semantic index not ready yet — retry shortly.`;

  const wantRerank = args.rerank === true || isRerankEnabled();
  // Over-fetch candidates when reranking so the cross-encoder has material.
  let files = await rankDocs(context, { query, limit: wantRerank ? CAND : limit, threshold: 0 });
  if (files.length === 0) {
    // Distinguish "no index" from "no hits" to keep the existing messages.
    const db = await loadIndex(indexPath(context));
    if (!db) return `Index not built yet — it builds automatically on first connect; retry shortly, or run the reindex command.`;
    return `No docs for "${query}".`;
  }
  if (wantRerank && files.length > 1) {
    const orderIdx = await rerank(query, files.map(h => ({ text: h.content })));
    files = orderIdx.map(i => files[i]);
  }
  files = files.slice(0, limit);
```

Keep the existing `compactText`, `MAX_SNIPPET_CHARS`, and the `parts`/`files.forEach` formatting exactly as-is. Ensure the remaining imports (`loadIndex`, `indexPath`, `embedQuery`) that are still referenced stay imported and unused ones are removed.

- [ ] **Step 5: Run tests to verify they pass**

Run: `NODE_PATH=/Users/josippapez/.claude/plugins/data/interactive-mcp-ai-setup/node_modules REPO_DOCS_MODELS_DIR=$HOME/.claude/repo-docs-models node --test claude/plugins/interactive-mcp/runtime/lib/doc-search.test.cjs`
Expected: PASS (1 test).

- [ ] **Step 6: Mirror to markdown-orchestration + verify byte-identity**

```bash
cp claude/plugins/interactive-mcp/runtime/lib/doc-search.cjs claude/plugins/markdown-orchestration/runtime/lib/doc-search.cjs
cp claude/plugins/interactive-mcp/runtime/lib/doc-search.test.cjs claude/plugins/markdown-orchestration/runtime/lib/doc-search.test.cjs
cp claude/plugins/interactive-mcp/runtime/tools/find-docs.cjs claude/plugins/markdown-orchestration/runtime/tools/find-docs.cjs
diff -r claude/plugins/interactive-mcp/runtime claude/plugins/markdown-orchestration/runtime && echo IDENTICAL
```
Expected: `IDENTICAL`.

- [ ] **Step 7: Commit**

```bash
git add claude/plugins/interactive-mcp/runtime claude/plugins/markdown-orchestration/runtime
git commit -m "refactor(repo-docs): extract rankDocs shared ranking helper"
```

---

### Task 2: Injection socket server (`lib/inject-server.cjs`)

A module the MCP server calls to host the NDJSON query socket, reusing the warm worker.

**Files:**
- Create: `claude/plugins/interactive-mcp/runtime/lib/inject-server.cjs`
- Test: `claude/plugins/interactive-mcp/runtime/lib/inject-server.test.cjs`
- Mirror both to `markdown-orchestration`.

**Interfaces:**
- Consumes: `rankDocs` (Task 1).
- Produces:
  - `injectSocketPath(root) : string` → `<root>/.claude/repo-docs/inject.sock`.
  - `startInjectServer(context, { rank = rankDocs } = {}) : Promise<net.Server|null>` — returns `null` (no-op) unless `process.env.REPO_DOCS_INJECT === '1'`. Binds the socket; on `EADDRINUSE` (another server already hosts) resolves `null` without throwing; cleans a stale socket file first. Each connection: reads one NDJSON request `{query,limit,threshold}`, replies one NDJSON line `{hits:[{path,startLine,heading,snippet,score}],injected:bool}`, closes. `injected` is `hits.length>0`. `snippet` is `content` trimmed to 180 chars, markdown-stripped like `find_docs`.

- [ ] **Step 1: Write the failing test**

```javascript
// claude/plugins/interactive-mcp/runtime/lib/inject-server.test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { startInjectServer, injectSocketPath } = require('./inject-server.cjs');

function ask(sockPath, req) {
  return new Promise((resolve, reject) => {
    const c = net.connect(sockPath, () => c.write(JSON.stringify(req) + '\n'));
    let buf = '';
    c.on('data', d => { buf += d; if (buf.includes('\n')) { c.end(); resolve(JSON.parse(buf.trim())); } });
    c.on('error', reject);
  });
}

test('inject server returns ranked hits over the socket, gated by env', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-'));
  fs.mkdirSync(path.join(root, '.claude', 'repo-docs'), { recursive: true });
  const context = { root, maxFileSizeBytes: 1e6 };

  // env off → no server
  delete process.env.REPO_DOCS_INJECT;
  assert.strictEqual(await startInjectServer(context), null);

  // env on → server, with a stub ranker (no model needed)
  process.env.REPO_DOCS_INJECT = '1';
  const stub = async (_ctx, { query }) =>
    query.includes('auth') ? [{ path: 'docs/auth.md', heading: 'Auth', content: 'token refresh '.repeat(30), startLine: 1, score: 0.9 }] : [];
  const server = await startInjectServer(context, { rank: stub });
  assert.ok(server, 'server should start when enabled');

  const hit = await ask(injectSocketPath(root), { query: 'auth login', limit: 3, threshold: 0 });
  assert.strictEqual(hit.injected, true);
  assert.strictEqual(hit.hits[0].path, 'docs/auth.md');
  assert.ok(hit.hits[0].snippet.length <= 180);

  const miss = await ask(injectSocketPath(root), { query: 'unrelated', limit: 3, threshold: 0 });
  assert.strictEqual(miss.injected, false);
  assert.deepStrictEqual(miss.hits, []);

  await new Promise(r => server.close(r));
  delete process.env.REPO_DOCS_INJECT;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test claude/plugins/interactive-mcp/runtime/lib/inject-server.test.cjs`
Expected: FAIL — `Cannot find module './inject-server.cjs'`.

- [ ] **Step 3: Write `lib/inject-server.cjs`**

```javascript
'use strict';

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { rankDocs } = require('./doc-search.cjs');

const MAX_SNIPPET_CHARS = 180;

function injectSocketPath(root) {
  return path.join(root, '.claude', 'repo-docs', 'inject.sock');
}

function snippet(content) {
  return String(content || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[!`*_>#~|[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SNIPPET_CHARS);
}

// Host the injection query socket. No-op unless REPO_DOCS_INJECT=1. First server
// to bind wins; a second (the other byte-identical plugin runtime) sees EADDRINUSE
// and resolves null. Reuses the caller's warm embedder via rankDocs.
async function startInjectServer(context, { rank = rankDocs } = {}) {
  if (process.env.REPO_DOCS_INJECT !== '1') return null;
  const sockPath = injectSocketPath(context.root);
  fs.mkdirSync(path.dirname(sockPath), { recursive: true });

  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', async (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      let req;
      try { req = JSON.parse(buf.slice(0, nl)); } catch { conn.end(); return; }
      try {
        const hits = await rank(context, {
          query: String(req.query || ''),
          limit: Number(req.limit) || 3,
          threshold: Number(req.threshold) || 0,
        });
        const out = hits.map(h => ({
          path: h.path, startLine: h.startLine, heading: h.heading, snippet: snippet(h.content), score: h.score,
        }));
        conn.end(JSON.stringify({ hits: out, injected: out.length > 0 }) + '\n');
      } catch {
        conn.end(JSON.stringify({ hits: [], injected: false }) + '\n');
      }
    });
    conn.on('error', () => {});
  });

  return await new Promise((resolve) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') { resolve(null); return; }
      // Stale socket from a crashed server: unlink and retry once.
      if (err.code === 'EADDRINUSE' || err.code === 'EEXIST') { try { fs.rmSync(sockPath, { force: true }); } catch {} }
      resolve(null);
    });
    // Proactively clear a stale socket file before binding.
    try { fs.rmSync(sockPath, { force: true }); } catch {}
    server.listen(sockPath, () => resolve(server));
  });
}

module.exports = { startInjectServer, injectSocketPath };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test claude/plugins/interactive-mcp/runtime/lib/inject-server.test.cjs`
Expected: PASS (1 test).

- [ ] **Step 5: Mirror + byte-identity + commit**

```bash
cp claude/plugins/interactive-mcp/runtime/lib/inject-server.cjs claude/plugins/markdown-orchestration/runtime/lib/inject-server.cjs
cp claude/plugins/interactive-mcp/runtime/lib/inject-server.test.cjs claude/plugins/markdown-orchestration/runtime/lib/inject-server.test.cjs
diff -r claude/plugins/interactive-mcp/runtime claude/plugins/markdown-orchestration/runtime && echo IDENTICAL
git add claude/plugins/interactive-mcp/runtime claude/plugins/markdown-orchestration/runtime
git commit -m "feat(repo-docs): injection socket server (opt-in, EADDRINUSE-safe)"
```

---

### Task 3: Wire the socket into the MCP server

**Files:**
- Modify: `claude/plugins/interactive-mcp/runtime/standalone-mcp.cjs` (mirror to markdown-orchestration)
- Modify: `claude/plugins/interactive-mcp/.mcp.json` (set `REPO_DOCS_INJECT=1`; interactive-mcp only)

**Interfaces:**
- Consumes: `startInjectServer` (Task 2).

- [ ] **Step 1: Add the import + startup call**

In `standalone-mcp.cjs`, add near the other lib requires:

```javascript
const { startInjectServer } = require('./lib/inject-server.cjs');
```

In the `initialize` handler, right after the existing `buildDocIndex(context).catch(() => {});` line, add:

```javascript
    // Host the proactive-injection query socket (no-op unless REPO_DOCS_INJECT=1;
    // first server to bind wins, so the sibling plugin runtime backs off).
    startInjectServer(context).catch(() => {});
```

- [ ] **Step 2: Verify it still parses**

Run: `node --check claude/plugins/interactive-mcp/runtime/standalone-mcp.cjs`
Expected: no output (exit 0).

- [ ] **Step 3: Enable the flag for interactive-mcp only**

In `claude/plugins/interactive-mcp/.mcp.json`, add `REPO_DOCS_INJECT` to the `interactive-mcp-standalone` server's `env` block:

```json
    "env": {
      "NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules",
      "REPO_DOCS_INJECT": "1"
    }
```

(Do NOT add this to markdown-orchestration's `.mcp.json` — only one host is needed; the EADDRINUSE backoff covers the race if both were ever enabled.)

- [ ] **Step 4: Mirror standalone-mcp + byte-identity check**

```bash
cp claude/plugins/interactive-mcp/runtime/standalone-mcp.cjs claude/plugins/markdown-orchestration/runtime/standalone-mcp.cjs
diff -r claude/plugins/interactive-mcp/runtime claude/plugins/markdown-orchestration/runtime && echo IDENTICAL
```
Expected: `IDENTICAL` (the `.mcp.json` differs between plugins — that's fine, it's not under `runtime/`).

- [ ] **Step 5: Commit**

```bash
git add claude/plugins/interactive-mcp/runtime claude/plugins/markdown-orchestration/runtime claude/plugins/interactive-mcp/.mcp.json
git commit -m "feat(repo-docs): MCP server hosts the injection socket on initialize"
```

---

> **⚠️ SUPERSEDED — Tasks 4–7 (hooks + wiring): read the epic issue `03-hooks` for the authoritative version.** Per the user's self-contained + on-by-default decision, the hooks are bundled INSIDE the plugin: `.cjs` scripts in `claude/plugins/interactive-mcp/hooks/` (+ `hooks/lib/`), registered in the plugin's own `hooks/hooks.json` via `${CLAUDE_PLUGIN_ROOT}` — **`claude/settings.json` is NOT modified**. Activation is **socket-presence** (hooks don't read `REPO_DOCS_INJECT`; the single toggle is the server's `.mcp.json` flag, shipped `=1`). The query/dedup LOGIC below still applies; only the file locations (`.cjs` in the plugin), the registration target (`hooks.json` not `settings.json`), and the removal of the hook-side env gate change. Tasks 1–3, 8–10 are unchanged except test paths (see Task 10).

### Task 4: Shared hook client helper (inline, dependency-free)

Hooks must not import plugin node_modules, so the socket client is a tiny inline helper duplicated into each hook is avoided by a single **`.mjs`** helper in the hooks dir (hooks import a sibling `.mjs`, still `node:`-only).

**Files:**
- Create: `claude/hooks/scripts/lib/inject-client.mjs`
- Test: `claude/hooks/scripts/lib/inject-client.test.mjs`

**Interfaces:**
- Produces:
  - `injectSocketPath(root)` → `${root}/.claude/repo-docs/inject.sock`.
  - `queryInject(root, req, timeoutMs=300) : Promise<{hits,injected}|null>` — connects, sends one NDJSON line, resolves the parsed reply, or `null` on any error/timeout/absent socket.
  - `formatBlock(hits) : string` — the `additionalContext` text (empty string if no hits).

- [ ] **Step 1: Write the failing test**

```javascript
// claude/hooks/scripts/lib/inject-client.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { queryInject, injectSocketPath, formatBlock } from './inject-client.mjs';

test('queryInject returns null when socket absent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-'));
  assert.strictEqual(await queryInject(root, { query: 'x' }, 200), null);
});

test('queryInject round-trips against a stub server; formatBlock renders pointers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-'));
  fs.mkdirSync(path.join(root, '.claude', 'repo-docs'), { recursive: true });
  const server = net.createServer((c) => {
    c.on('data', () => c.end(JSON.stringify({ injected: true, hits: [{ path: 'docs/a.md', startLine: 4, heading: 'H', snippet: 'snip' }] }) + '\n'));
  });
  await new Promise(r => server.listen(injectSocketPath(root), r));
  const res = await queryInject(root, { query: 'q', limit: 3 }, 500);
  assert.strictEqual(res.injected, true);
  const block = formatBlock(res.hits);
  assert.match(block, /docs\/a\.md:4/);
  assert.match(block, /read_doc/);
  await new Promise(r => server.close(r));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test claude/hooks/scripts/lib/inject-client.test.mjs`
Expected: FAIL — cannot find `./inject-client.mjs`.

- [ ] **Step 3: Write `inject-client.mjs`**

```javascript
import net from 'node:net';
import path from 'node:path';

export function injectSocketPath(root) {
  return path.join(root, '.claude', 'repo-docs', 'inject.sock');
}

// Connect, send one NDJSON request, resolve the parsed reply. Any error, timeout,
// or absent socket → null (caller then injects nothing).
export function queryInject(root, req, timeoutMs = 300) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const c = net.connect(injectSocketPath(root));
    const timer = setTimeout(() => { c.destroy(); finish(null); }, timeoutMs);
    let buf = '';
    c.on('connect', () => c.write(JSON.stringify(req) + '\n'));
    c.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      clearTimeout(timer); c.end();
      try { finish(JSON.parse(buf.slice(0, nl))); } catch { finish(null); }
    });
    c.on('error', () => { clearTimeout(timer); finish(null); });
    c.on('close', () => { clearTimeout(timer); finish(null); });
  });
}

export function formatBlock(hits) {
  if (!hits || hits.length === 0) return '';
  const lines = hits.map((h, i) => {
    const anchor = h.heading ? ` › ${h.heading}` : '';
    return `${i + 1}) ${h.path}:${h.startLine}${anchor} — ${h.snippet}`;
  });
  return `[repo-docs] Possibly relevant local docs — open with read_doc if useful:\n${lines.join('\n')}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test claude/hooks/scripts/lib/inject-client.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add claude/hooks/scripts/lib/inject-client.mjs claude/hooks/scripts/lib/inject-client.test.mjs
git commit -m "feat(hooks): dependency-free inject socket client + formatter"
```

---

### Task 5: `UserPromptSubmit` hook

**Files:**
- Create: `claude/hooks/scripts/inject-on-prompt.mjs`
- Test: `claude/hooks/scripts/inject-on-prompt.test.mjs`

**Interfaces:**
- Consumes: `queryInject`, `formatBlock` (Task 4).
- Behavior: reads event JSON from stdin (`{ prompt, cwd }`), queries the socket with the prompt at the prompt threshold, prints `hookSpecificOutput.additionalContext` JSON when hits exist, else exits 0 silently. Emits nothing unless `REPO_DOCS_INJECT=1`.

- [ ] **Step 1: Write the failing test** (drives the hook as a child process against a stub socket)

```javascript
// claude/hooks/scripts/inject-on-prompt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { injectSocketPath } from './lib/inject-client.mjs';

const HOOK = new URL('./inject-on-prompt.mjs', import.meta.url).pathname;

function run(event, env) {
  return execFileSync('node', [HOOK], { input: JSON.stringify(event), env: { ...process.env, ...env }, encoding: 'utf8' });
}

test('prints additionalContext when the socket returns hits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iop-'));
  fs.mkdirSync(path.join(root, '.claude', 'repo-docs'), { recursive: true });
  const server = net.createServer((c) => c.on('data', () => c.end(JSON.stringify({ injected: true, hits: [{ path: 'docs/a.md', startLine: 1, heading: 'H', snippet: 's' }] }) + '\n')));
  await new Promise(r => server.listen(injectSocketPath(root), r));
  const out = run({ prompt: 'how does auth work', cwd: root }, { REPO_DOCS_INJECT: '1' });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(parsed.hookSpecificOutput.additionalContext, /docs\/a\.md:1/);
  await new Promise(r => server.close(r));
});

test('silent when disabled', () => {
  const out = run({ prompt: 'x', cwd: os.tmpdir() }, { REPO_DOCS_INJECT: '' });
  assert.strictEqual(out.trim(), '');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test claude/hooks/scripts/inject-on-prompt.test.mjs`
Expected: FAIL — hook file missing.

- [ ] **Step 3: Write `inject-on-prompt.mjs`**

```javascript
#!/usr/bin/env node
import { queryInject, formatBlock } from './lib/inject-client.mjs';

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const main = async () => {
  if (process.env.REPO_DOCS_INJECT !== '1') process.exit(0);
  let event;
  try { event = JSON.parse(await readStdin()); } catch { process.exit(0); }
  const prompt = String(event?.prompt || '').trim();
  const root = event?.cwd || process.cwd();
  // Skip trivial prompts.
  if (prompt.replace(/[^a-zA-Z]/g, '').length < 8) process.exit(0);

  const res = await queryInject(root, {
    query: prompt,
    limit: num(process.env.REPO_DOCS_INJECT_LIMIT, 3),
    threshold: num(process.env.REPO_DOCS_INJECT_THRESHOLD, 0),
  }, num(process.env.REPO_DOCS_INJECT_TIMEOUT_MS, 300));

  if (!res || !res.injected || !res.hits?.length) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: formatBlock(res.hits) },
  }));
};

main().catch(() => process.exit(0));
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test claude/hooks/scripts/inject-on-prompt.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add claude/hooks/scripts/inject-on-prompt.mjs claude/hooks/scripts/inject-on-prompt.test.mjs
git commit -m "feat(hooks): UserPromptSubmit doc-injection hook"
```

---

### Task 6: `PostToolBatch`/`PostToolUse` progress hook with per-session dedup

**Files:**
- Create: `claude/hooks/scripts/inject-on-progress.mjs`
- Test: `claude/hooks/scripts/inject-on-progress.test.mjs`

**Interfaces:**
- Consumes: `queryInject`, `formatBlock` (Task 4).
- Behavior: reads event JSON (`{ transcript_path, session_id, cwd }`), derives a query from the last user message in the transcript, queries at the **progress** threshold, dedups already-injected doc paths via `<root>/.claude/repo-docs/inject-state/<session_id>.json`, injects only new hits, exits 0 silently otherwise. Disabled unless `REPO_DOCS_INJECT=1` and `REPO_DOCS_INJECT_EVENTS` includes `batch`.

- [ ] **Step 1: Write the failing test**

```javascript
// claude/hooks/scripts/inject-on-progress.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { injectSocketPath } from './lib/inject-client.mjs';

const HOOK = new URL('./inject-on-progress.mjs', import.meta.url).pathname;
function run(event, env) {
  return execFileSync('node', [HOOK], { input: JSON.stringify(event), env: { ...process.env, ...env }, encoding: 'utf8' });
}
function transcript(root, userText) {
  const p = path.join(root, 't.jsonl');
  fs.writeFileSync(p, JSON.stringify({ type: 'user', message: { role: 'user', content: userText } }) + '\n');
  return p;
}

test('injects fresh hits, then dedups on second run', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iprog-'));
  fs.mkdirSync(path.join(root, '.claude', 'repo-docs'), { recursive: true });
  const server = net.createServer((c) => c.on('data', () => c.end(JSON.stringify({ injected: true, hits: [{ path: 'docs/a.md', startLine: 1, heading: 'H', snippet: 's' }] }) + '\n')));
  await new Promise(r => server.listen(injectSocketPath(root), r));
  const env = { REPO_DOCS_INJECT: '1', REPO_DOCS_INJECT_EVENTS: 'prompt,batch' };
  const ev = { transcript_path: transcript(root, 'how does auth login work'), session_id: 'sess1', cwd: root };
  const first = run(ev, env);
  assert.match(JSON.parse(first).hookSpecificOutput.additionalContext, /docs\/a\.md/);
  const second = run(ev, env);
  assert.strictEqual(second.trim(), ''); // deduped
  await new Promise(r => server.close(r));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test claude/hooks/scripts/inject-on-progress.test.mjs`
Expected: FAIL — hook missing.

- [ ] **Step 3: Write `inject-on-progress.mjs`**

```javascript
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { queryInject, formatBlock } from './lib/inject-client.mjs';

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Last user message text from a Claude Code transcript JSONL.
function lastUserText(transcriptPath) {
  let text = '';
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      const msg = row.message || row;
      if (msg?.role === 'user' || row.type === 'user') {
        const c = msg?.content;
        text = typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => p?.text || '').join(' ') : text;
      }
    }
  } catch {}
  return text.trim();
}

function statePath(root, session) {
  return path.join(root, '.claude', 'repo-docs', 'inject-state', `${session || 'default'}.json`);
}
function loadSeen(p) { try { return new Set(JSON.parse(fs.readFileSync(p, 'utf8'))); } catch { return new Set(); } }
function saveSeen(p, set) { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify([...set])); } catch {} }

const main = async () => {
  if (process.env.REPO_DOCS_INJECT !== '1') process.exit(0);
  const events = (process.env.REPO_DOCS_INJECT_EVENTS || 'prompt,batch').split(',').map(s => s.trim());
  if (!events.includes('batch')) process.exit(0);

  let event;
  try { event = JSON.parse(await readStdin()); } catch { process.exit(0); }
  const root = event?.cwd || process.cwd();
  const query = lastUserText(event?.transcript_path);
  if (query.replace(/[^a-zA-Z]/g, '').length < 8) process.exit(0);

  const res = await queryInject(root, {
    query,
    limit: num(process.env.REPO_DOCS_INJECT_LIMIT, 3),
    threshold: num(process.env.REPO_DOCS_INJECT_THRESHOLD_PROGRESS, num(process.env.REPO_DOCS_INJECT_THRESHOLD, 0)),
  }, num(process.env.REPO_DOCS_INJECT_TIMEOUT_MS, 300));
  if (!res || !res.injected || !res.hits?.length) process.exit(0);

  const sp = statePath(root, event?.session_id);
  const seen = loadSeen(sp);
  const fresh = res.hits.filter(h => !seen.has(h.path));
  if (fresh.length === 0) process.exit(0);
  fresh.forEach(h => seen.add(h.path));
  saveSeen(sp, seen);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event?.hook_event_name || 'PostToolBatch', additionalContext: formatBlock(fresh) },
  }));
};

main().catch(() => process.exit(0));
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test claude/hooks/scripts/inject-on-progress.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add claude/hooks/scripts/inject-on-progress.mjs claude/hooks/scripts/inject-on-progress.test.mjs
git commit -m "feat(hooks): PostToolBatch/PostToolUse progress doc-injection with dedup"
```

---

### Task 7: Wire hooks into `settings.json`

**Files:**
- Modify: `claude/settings.json`

**Interfaces:** consumes the three hook scripts.

- [ ] **Step 1: Inspect current hooks block**

Run: `node -e "console.log(JSON.stringify(require('./claude/settings.json').hooks, null, 2))"`
Expected: prints the existing `hooks` object (note the existing `UserPromptSubmit` / `PostToolUse` entries so the new commands are ADDED, not replaced).

- [ ] **Step 2: Add the hook commands**

Add to `claude/settings.json` `hooks` (merge into existing arrays, do not overwrite the prompt-loop-reminder entries). Use `$CLAUDE_PROJECT_DIR`-relative paths consistent with the existing hook entries' style:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/claude/hooks/scripts/inject-on-prompt.mjs\"" } ] }
    ],
    "PostToolBatch": [
      { "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/claude/hooks/scripts/inject-on-progress.mjs\"" } ] }
    ],
    "PostToolUse": [
      { "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/claude/hooks/scripts/inject-on-progress.mjs\"" } ] }
    ]
  }
}
```

> NOTE for the implementer: read the ACTUAL existing `claude/settings.json` first and merge these command entries into the existing event arrays (matching the existing entry shape and matcher usage). If `PostToolBatch` is unsupported by the installed Claude Code build, keep only the `PostToolUse` wiring (the hook self-dedups). The exact merge must preserve every pre-existing hook.

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('claude/settings.json','utf8')); console.log('valid')"`
Expected: `valid`.

- [ ] **Step 4: Commit**

```bash
git add claude/settings.json
git commit -m "feat(hooks): wire doc-injection hooks (UserPromptSubmit + PostToolBatch/PostToolUse)"
```

---

### Task 8: Threshold calibration script

**Files:**
- Create: `claude/plugins/interactive-mcp/runtime/tools/inject-calibrate.cjs` (mirror to markdown-orchestration)

**Interfaces:** consumes `rankDocs` (Task 1) + the built index for a given repo root.

- [ ] **Step 1: Write the calibration script**

```javascript
'use strict';
// Usage: NODE_PATH=<plugin-data>/node_modules node inject-calibrate.cjs <repo-root> "query one" "query two" ...
// Prints, per query, the top-5 hit scores so a human can pick REPO_DOCS_INJECT_THRESHOLD.
const { createContext } = require('../lib/context.cjs');
const { warmUp, waitUntilReady, shutdown } = require('../lib/semantic-index.cjs');
const { rankDocs } = require('../lib/doc-search.cjs');

(async () => {
  const [root, ...queries] = process.argv.slice(2);
  if (!root || queries.length === 0) { process.stderr.write('usage: inject-calibrate.cjs <root> <query...>\n'); process.exit(1); }
  const context = createContext(root);
  warmUp();
  if (!(await waitUntilReady())) { process.stderr.write('embedder not ready\n'); process.exit(1); }
  for (const q of queries) {
    const hits = await rankDocs(context, { query: q, limit: 5, threshold: 0 });
    process.stdout.write(`\n"${q}"\n`);
    hits.forEach(h => process.stdout.write(`  ${h.score.toFixed(4)}  ${h.path}:${h.startLine}\n`));
    if (hits.length === 0) process.stdout.write('  (no hits)\n');
  }
  await shutdown();
})().catch((e) => { process.stderr.write(`calibrate error: ${e.message}\n`); process.exit(1); });
```

- [ ] **Step 2: Run it against this repo to gather scores**

Run:
```bash
NODE_PATH=/Users/josippapez/.claude/plugins/data/interactive-mcp-ai-setup/node_modules REPO_DOCS_MODELS_DIR=$HOME/.claude/repo-docs-models \
node claude/plugins/interactive-mcp/runtime/tools/inject-calibrate.cjs "$PWD" \
  "how does the semantic search engine work" \
  "what are the orchestration rules" \
  "hello can you help me" \
  "thanks that looks good"
```
Expected: relevant repo queries show high top scores; the chit-chat queries show low/no hits. Pick a `REPO_DOCS_INJECT_THRESHOLD` (and a higher `_PROGRESS`) that separates them; record the chosen values in the spec's Configuration section.

- [ ] **Step 3: Record chosen defaults + mirror + commit**

Update the spec Configuration section with the chosen numbers. Then:
```bash
cp claude/plugins/interactive-mcp/runtime/tools/inject-calibrate.cjs claude/plugins/markdown-orchestration/runtime/tools/inject-calibrate.cjs
diff -r claude/plugins/interactive-mcp/runtime claude/plugins/markdown-orchestration/runtime && echo IDENTICAL
git add claude/plugins/*/runtime/tools/inject-calibrate.cjs docs/superpowers/specs/2026-07-16-proactive-doc-injection-design.md
git commit -m "feat(repo-docs): threshold calibration script + recorded defaults"
```

---

### Task 9: Bump plugin version + docs-sync

**Files:**
- Modify: `claude/plugins/interactive-mcp/.claude-plugin/plugin.json` (version bump — version-keyed cache)
- Modify: `claude/plugins/interactive-mcp/README.md` (+ markdown-orchestration README if it documents the engine)
- Modify: `docs/superpowers/specs/2026-07-16-proactive-doc-injection-design.md` (status → Implemented)

- [ ] **Step 1: Bump the plugin version**

Read `claude/plugins/interactive-mcp/.claude-plugin/plugin.json`, increment the `version` (patch or minor). Do the same for markdown-orchestration only if its runtime changed (it did — the mirrored files). Run: `node -e "console.log(require('./claude/plugins/interactive-mcp/.claude-plugin/plugin.json').version)"` to confirm.

- [ ] **Step 2: Document the feature in the plugin README**

Add a concise section to `claude/plugins/interactive-mcp/README.md` describing: what proactive injection does, that it's opt-in via `REPO_DOCS_INJECT=1`, the config env vars (`REPO_DOCS_INJECT_THRESHOLD`, `_THRESHOLD_PROGRESS`, `_LIMIT`, `_TIMEOUT_MS`, `_EVENTS`), and that it reuses the running MCP server's warm model. Link to the spec.

- [ ] **Step 3: Flip the spec status**

Change the spec header `Status:` to `Implemented (2026-…)` and mark the OpenCode-parity + LLM-judge items as remaining follow-ups.

- [ ] **Step 4: Validate + commit**

```bash
node -e "JSON.parse(require('fs').readFileSync('claude/plugins/interactive-mcp/.claude-plugin/plugin.json','utf8')); console.log('plugin.json valid')"
git add claude/plugins/interactive-mcp/.claude-plugin/plugin.json claude/plugins/*/README.md docs/superpowers/specs/2026-07-16-proactive-doc-injection-design.md
git commit -m "docs(repo-docs): document proactive doc-injection + bump plugin version"
```

---

### Task 10: Full regression + manual integration check

- [ ] **Step 1: Run the whole runtime test suite (both copies)**

```bash
export NODE_PATH=/Users/josippapez/.claude/plugins/data/interactive-mcp-ai-setup/node_modules
export REPO_DOCS_MODELS_DIR=$HOME/.claude/repo-docs-models
node --test claude/plugins/interactive-mcp/runtime/lib/*.test.cjs claude/plugins/interactive-mcp/runtime/tools/*.test.cjs
node --test claude/plugins/interactive-mcp/hooks/lib/*.test.cjs claude/plugins/interactive-mcp/hooks/*.test.cjs
```
Expected: all pass.

- [ ] **Step 2: Byte-identity final check**

```bash
diff -r claude/plugins/interactive-mcp/runtime claude/plugins/markdown-orchestration/runtime && echo IDENTICAL
```
Expected: `IDENTICAL`.

- [ ] **Step 3: Manual integration (real session)**

Enable via `REPO_DOCS_INJECT=1` (already set in `.mcp.json` for interactive-mcp), start a fresh Claude Code session in this repo, ask "how does the semantic search engine work here", and confirm a `[repo-docs] Possibly relevant local docs …` block appears in context and the agent can `read_doc` a pointer. Note the observed behavior.

- [ ] **Step 4: Final commit (if any manual-tuning tweaks)**

```bash
git add -A && git commit -m "test(repo-docs): regression + manual integration verification for doc-injection"
```

---

## Self-Review

**Spec coverage:** decision engine (Task 1 rankDocs + threshold), warm socket hosted by MCP server (Tasks 2–3), UserPromptSubmit (Task 5), PostToolBatch→PostToolUse fallback + dedup (Task 6), settings wiring (Task 7), config env (Tasks 5/6 + README Task 9), calibration (Task 8), byte-identity (every runtime task), opt-in + fail-safe (Global Constraints, enforced in Tasks 2/5/6), plugin version bump + docs-sync (Task 9), testing + manual integration (Task 10). OpenCode parity + LLM judge are explicitly deferred (spec Non-goals) — no task, by design.

**Placeholder scan:** no TBD/TODO in code steps; the only human-judgment step (threshold value in Task 8) is a real calibration action with a concrete command and a "record the number" follow-through, not a placeholder.

**Type consistency:** `rankDocs(context,{query,limit,threshold})→[{path,heading,content,startLine,score}]` is produced in Task 1 and consumed identically in Tasks 2 and 8. The socket reply shape `{hits:[{path,startLine,heading,snippet,score}],injected}` is produced in Task 2 and consumed identically in Tasks 4/5/6. `queryInject`/`formatBlock`/`injectSocketPath` signatures match across Tasks 4–6. Socket path convention (`.claude/repo-docs/inject.sock`) is identical in `inject-server.cjs` (Task 2) and `inject-client.mjs` (Task 4).
