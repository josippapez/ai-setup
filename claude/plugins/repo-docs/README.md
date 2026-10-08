# repo-docs

Local semantic doc search, installed-package lookup and JS/TS file-impact tools for one repository. Split out of `dev-core` so `dev-core` and `orchestrate` share one MCP server and one tool namespace instead of each bundling an identical copy.

**Any plugin that uses its tools must declare `repo-docs` as a dependency in its own README/skill and tell the user to install it if `mcp__plugin_repo-docs_repo-docs__*` is not callable.** `claude/install.sh` installs it automatically alongside `dev-core` and `orchestrate`.

## Layout

- `.mcp.json` — the `repo-docs` server (`runtime/`): `find_docs`, `list_docs`, `read_doc`, `find_libs`, `get_file_dependents`, `get_blast_radius`. Markdown conventions, installed packages, and which JS/TS files import a file (directly or transitively, resolving tsconfig `paths` aliases and workspace package names).
- `hooks/` — dependency setup, index lifecycle.
- `commands/` — `/reindex` and `/repo-docs-ignore`.

## Dependencies auto-install

`opencode/plugins/dev-core` runs a copy of `runtime/`. Only `lib/platform.cjs` (the `.claude`/`.opencode` folder and the model cache), `lib/context.cjs` and `standalone-mcp.cjs` differ; `opencode/plugins/dev-core/repo-docs-sync.test.cjs` fails when any other file drifts, so copy changed runtime files across.

No manual `npm install`. A `SessionStart` hook (`hooks/hooks.json`) runs `npm install` into the plugin's persistent data dir (`${CLAUDE_PLUGIN_DATA}/node_modules`) on first session and again whenever `package.json` changes; the MCP server resolves them via `NODE_PATH`. The first session may take a moment while `@huggingface/transformers` installs (the `bge-small` model is ~128 MB); later sessions are instant (deps persist across plugin updates). Embedding/reranker **models are cached in a shared dir** — `~/.claude/repo-docs-models` by default, override with the `REPO_DOCS_MODELS_DIR` env var.

## Docs index warms on connect

The MCP pre-embeds the repo's Markdown in the background when it connects (fire-and-forget, incremental via an mtime cache), so the first `find_docs` doesn't pay the indexing cost. `find_docs` runs a chunked hybrid search (BM25 keyword + dense `bge-small` embeddings) and returns, per file, the best-matching chunk with its section anchor and a snippet. Each chunk is embedded twice, on its own and with its doc path and heading breadcrumb in front, on the GPU (WebGPU, 16 texts a run) when onnxruntime can load it and on one CPU thread otherwise; the two rankings are fused, and a cross-encoder (`bge-reranker-base`) votes on the top 10. The vote adds about half a second per call; pass `rerank: false`, or set `RERANK_ENABLED=0` for every call, to skip it. A query that finds the model not loaded yet waits up to 5 s for it (a load takes about half a second once the model is downloaded). If it is still not ready, or before the first index build, `find_docs` answers with a keyword scorer and its header says why and when to call it again. `read_doc` returns the raw file by default, so `find_docs` line numbers line up; `compact: true` returns a minified read. Force a rebuild of changed files any time with `/reindex` or `node runtime/tools/build-semantic-index.cjs <repo-root>` (delete `.claude/repo-docs/` first for a full rebuild).

At the end of a turn that touched a Markdown file, the mod in `hooks/reindex.ts` runs `hooks/reindex-on-edit.cjs`, which asks the running server, over a local socket (`.claude/repo-docs/inject.sock`), to re-embed changed docs, so mid-session doc edits are searchable without a reconnect.

## Removed in 0.3.0

`get_file_dependents` and `get_blast_radius` came back in 0.5.0 after CodeGraph replaced them: on a measured impact task in a TypeScript monorepo, CodeGraph listed 9 of 16 affected files and `get_blast_radius` listed all 16. Use them for the file list before a move, rename, delete or API change. CodeGraph itself was dropped from the plugin in 0.6.0. The proactive doc-pointer injection (UserPromptSubmit and PostToolBatch hooks) and the one-shot Grep/Glob reminder were removed after measuring 1,879 injections across 39 sessions with zero `read_doc` follow-ups.

## Reap on exit

A `SessionEnd` hook (`hooks/reap-mcp-on-exit.cjs`) kills this session's own `standalone-mcp.cjs` process on exit — Claude Code doesn't always reap plugin MCP servers, so they'd otherwise accumulate across sessions.

## Tests

```bash
node --test claude/plugins/repo-docs/hooks/*.test.cjs claude/plugins/repo-docs/runtime/lib/*.test.cjs claude/plugins/repo-docs/runtime/tools/*.test.cjs
```

## Mod

`hooks/status.ts` shows "repo-docs: indexing docs…" with the build percentage while `.claude/repo-docs/index-build.lock` exists, and a toast when the build finishes.
- `hooks/transcript.tsx` draws the `/repo-docs:reindex` Bash call as "Reindex repo docs" and its result as a one-line count of re-embedded, unchanged and skipped docs.
- `hooks/grep-nudge.ts` adds a reminder to try `find_docs` after a Grep or Bash `rg`/`grep` aimed at `docs/` or Markdown, at most twice a session and never after `find_docs` has run. It skips `.orchestration`, `.claude/` and `node_modules`, which `find_docs` does not index.
- `hooks/reindex.ts` replaces the old `PostToolUse` reindex hook: when a turn ends, if it touched a markdown file through Edit, Write or a Bash command naming one, it asks the running server to re-embed changed docs once.
