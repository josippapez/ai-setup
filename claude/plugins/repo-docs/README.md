# repo-docs

Local semantic doc search and installed-package lookup for one repository, plus the [CodeGraph](https://github.com/colbymchenry/codegraph) code-graph MCP server. Split out of `dev-core` so `dev-core` and `orchestrate` share one set of MCP servers and one tool namespace instead of each bundling an identical copy.

**Any plugin that uses its tools must declare `repo-docs` as a dependency in its own README/skill and tell the user to install it if `mcp__plugin_repo-docs_repo-docs__*` is not callable.** `claude/install.sh` installs it automatically alongside `dev-core` and `orchestrate`.

## Layout

- `.mcp.json` — two servers:
  - `repo-docs` (`runtime/`): `find_docs`, `list_docs`, `read_doc`, `find_libs`. Markdown conventions and installed packages.
  - `codegraph`: the `codegraph serve --mcp` server from the globally installed CLI. One tool, `codegraph_explore` (`mcp__plugin_repo-docs_codegraph__codegraph_explore`): a symbol's verbatim source, its callers and callees, call paths, and blast radius in one call. Use it before renaming, moving, or changing the public API of anything. Shell equivalent: `codegraph explore "<query>"`.
- `hooks/` — dependency setup, index lifecycle.
- `commands/` — `/reindex` and `/repo-docs-ignore`.

## CodeGraph setup

`claude/install.sh` installs the `codegraph` CLI (`npm i -g @colbymchenry/codegraph`). Each repo needs a one-time `codegraph init`; it writes a git-ignored `.codegraph/` directory and keeps it fresh with a file watcher. Repos without `.codegraph/` get clean "not indexed" guidance from the tool, nothing fails. CodeGraph's own `codegraph prompt-hook` is **not** wired up: measured over four firings it injected unrelated symbols every time (about 1.4k tokens for zero use), because its middle confidence tier matches ordinary prose words like "context" and "claude" against symbol-name segments. `claude/settings.json` sets `CODEGRAPH_NO_PROMPT_HOOK=1` so a stray `codegraph install` cannot revive it. Adoption is handled instead by the `codegraph` rule in `dev-core/rules/`, which that plugin injects at both `SessionStart` and `SubagentStart` so it reaches the main agent and every subagent from one source. Telemetry is off: `.mcp.json` and `claude/settings.json` set `CODEGRAPH_TELEMETRY=0`, and the installer runs `codegraph telemetry off`.

## Dependencies auto-install

No manual `npm install`. A `SessionStart` hook (`hooks/hooks.json`) runs `npm install` into the plugin's persistent data dir (`${CLAUDE_PLUGIN_DATA}/node_modules`) on first session and again whenever `package.json` changes; the MCP server resolves them via `NODE_PATH`. The first session may take a moment while `@huggingface/transformers` installs (the `bge-small` model is ~128 MB); later sessions are instant (deps persist across plugin updates). Embedding/reranker **models are cached in a shared dir** — `~/.claude/repo-docs-models` by default, override with the `REPO_DOCS_MODELS_DIR` env var.

## Docs index warms on connect

The MCP pre-embeds the repo's Markdown in the background when it connects (fire-and-forget, incremental via an mtime cache), so the first `find_docs` doesn't pay the indexing cost. `find_docs` runs a chunked hybrid search (BM25 keyword + dense `bge-small` embeddings) and returns, per file, the best-matching chunk with its section anchor and a snippet. An optional per-call `rerank` flag (or the `RERANK_ENABLED` env var) applies a cross-encoder reranker on top candidates — off by default. Force a rebuild any time with `/reindex` or `node runtime/tools/build-semantic-index.cjs <repo-root>`.

A `PostToolUse` hook (`hooks/reindex-on-edit.cjs`) asks the running server, over a local socket (`.claude/repo-docs/inject.sock`), to re-embed a Markdown file right after it is written or edited, so mid-session doc edits are searchable without a reconnect.

## Removed in 0.3.0

The JS/TS-only dependency-graph tools (`get_file_dependencies`, `get_file_dependents`, `get_blast_radius`, `get_repository_index_status`) were replaced by CodeGraph, which covers the same question with call edges across 20+ languages. The proactive doc-pointer injection (UserPromptSubmit and PostToolBatch hooks) and the one-shot Grep/Glob reminder were removed after measuring 1,879 injections across 39 sessions with zero `read_doc` follow-ups.

## Reap on exit

A `SessionEnd` hook (`hooks/reap-mcp-on-exit.cjs`) kills this session's own `standalone-mcp.cjs` process on exit — Claude Code doesn't always reap plugin MCP servers, so they'd otherwise accumulate across sessions.

## Tests

```bash
node --test claude/plugins/repo-docs/hooks/*.test.cjs claude/plugins/repo-docs/runtime/lib/*.test.cjs claude/plugins/repo-docs/runtime/tools/*.test.cjs
```
