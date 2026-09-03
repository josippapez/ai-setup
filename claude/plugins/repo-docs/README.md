# repo-docs

Local semantic doc search, dependency-graph analysis, and installed-package lookup for one repository, plus proactive doc-context injection. Split out of `dev-core` so `dev-core` and `orchestrate` share one MCP server and one tool namespace instead of each bundling an identical copy.

**Any plugin that uses its tools must declare `repo-docs` as a dependency in its own README/skill and tell the user to install it if `mcp__plugin_repo-docs_repo-docs__*` is not callable.** `claude/install.sh` installs it automatically alongside `dev-core` and `orchestrate`.

## Layout

- `.mcp.json` + `runtime/` — the standalone MCP server: `find_docs`, `list_docs`, `read_doc`, `find_libs`, and the dependency-graph tools (`get_file_dependencies`, `get_file_dependents`, `get_blast_radius`, `get_repository_index_status`).
- `hooks/` — dependency setup, index lifecycle, and doc-context injection (below).
- `commands/` — `/reindex` and `/repo-docs-ignore`.

## Dependencies auto-install

No manual `npm install`. A `SessionStart` hook (`hooks/hooks.json`) runs `npm install` into the plugin's persistent data dir (`${CLAUDE_PLUGIN_DATA}/node_modules`) on first session and again whenever `package.json` changes; the MCP server resolves them via `NODE_PATH`. The first session may take a moment while `@huggingface/transformers` installs (the `bge-small` model is ~128 MB); later sessions are instant (deps persist across plugin updates). Embedding/reranker **models are cached in a shared dir** — `~/.claude/repo-docs-models` by default, override with the `REPO_DOCS_MODELS_DIR` env var.

## Docs index warms on connect

The MCP pre-embeds the repo's Markdown in the background when it connects (fire-and-forget, incremental via an mtime cache), so the first `find_docs` doesn't pay the indexing cost. `find_docs` runs a chunked hybrid search (BM25 keyword + dense `bge-small` embeddings) and returns, per file, the best-matching chunk with its section anchor and a snippet. An optional per-call `rerank` flag (or the `RERANK_ENABLED` env var) applies a cross-encoder reranker on top candidates — off by default. Force a rebuild any time with `/reindex` or `node runtime/tools/build-semantic-index.cjs <repo-root>`.

## Proactive doc-context injection

Automatically surfaces the most relevant local docs at natural points in a conversation (on user prompt and as the agent works) by hosting a fast local socket that ranks queries against the warm index. Activation is socket-presence based: the MCP server always hosts a query socket (`REPO_DOCS_INJECT=1` in `.mcp.json`), and bundled hooks detect it and inject compact doc pointers via `additionalContext` whenever relevance clears a configurable threshold. Threshold-gated, per-session deduped, fail-safe. Configure via optional env vars:

- `REPO_DOCS_INJECT_THRESHOLD` (default 0.80) — minimum relevance score for the UserPromptSubmit hook
- `REPO_DOCS_INJECT_THRESHOLD_PROGRESS` (default 0.86) — higher threshold for the PostToolBatch (progress) hook
- `REPO_DOCS_INJECT_LIMIT` (default 3) — max doc pointers per injection
- `REPO_DOCS_INJECT_TIMEOUT_MS` (default 300) — socket connect timeout
- `REPO_DOCS_INJECT_WARM_ATTEMPTS` (default 3) / `REPO_DOCS_INJECT_WARM_DELAY_MS` (default 250) — bounded retry on the UserPromptSubmit hook while the server answers `warming: true` (its embedder still loading, i.e. the first prompt of a fresh or resumed session). ~750ms worst case; costs nothing once warm, and a plain miss / absent socket / timeout is never retried. The progress hook deliberately does not retry — it runs between tool calls, where waiting would stall the agent loop rather than a single prompt.
- `REPO_DOCS_INJECT_EVENTS` (default `prompt,batch`) — control which hooks are active

## Usage enforcement

A `PreToolUse` hook (matcher `Grep|Glob`, `hooks/enforce-doc-lookup.cjs`) reminds — once per session — to try `find_docs` before a broad search, if no repo-docs doc-lookup tool (`find_docs`/`list_docs`/`read_doc`/`find_libs`) has been called yet. It never blocks the tool call (`additionalContext` only, no `permissionDecision`), and goes silent for the rest of the session as soon as any doc-lookup tool is used, or after the first reminder. The MCP server tracks doc-lookup usage in memory and answers `{op: 'used-status'}` on the same inject socket.

## Reap on exit

A `SessionEnd` hook (`hooks/reap-mcp-on-exit.cjs`) kills this session's own `standalone-mcp.cjs` process on exit — Claude Code doesn't always reap plugin MCP servers, so they'd otherwise accumulate across sessions.

## Tests

```bash
node --test claude/plugins/repo-docs/hooks/*.test.cjs claude/plugins/repo-docs/hooks/lib/*.test.cjs claude/plugins/repo-docs/runtime/lib/*.test.cjs claude/plugins/repo-docs/runtime/tools/*.test.cjs
```
