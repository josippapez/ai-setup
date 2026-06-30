---
description: Rebuild the repo-docs semantic search index for the current repo (re-embeds all Markdown). Run after adding or heavily editing docs so find_docs reflects them.
argument-hint: "[repo-root path — defaults to the current repo]"
allowed-tools: Bash
---

# Reindex repo-docs

Rebuild the bundled repo-docs semantic index for the current repository, then report the result. Do **not** do anything else — this is a single mechanical step.

Run exactly this (it locates the plugin's bundled builder and its installed `@huggingface/transformers`, then rebuilds the index for the repo root):

```bash
ROOT="${ARGUMENTS:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
BASE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins"
BUILD="$(ls -d "$BASE"/cache/*/linear-orchestration/*/runtime/tools/build-semantic-index.cjs 2>/dev/null | sort -V | tail -1)"
MODULES="$(ls -d "$BASE"/data/linear-orchestration-*/node_modules 2>/dev/null | head -1)"
[ -n "$BUILD" ] && [ -n "$MODULES" ] && NODE_PATH="$MODULES" node "$BUILD" "$ROOT" || echo "reindex: plugin builder or deps not found — start a Claude Code session once so the SessionStart hook installs dependencies, then retry."
```

Where `$ARGUMENTS` is: $ARGUMENTS

Report the `semantic_index updated=… unchanged=… skipped=… cache=…` line back to the user verbatim. First run may download the embedding model (~90 MB) before indexing.
