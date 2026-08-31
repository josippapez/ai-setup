---
description: Directly rebuild the local repository-docs semantic index.
---

The `/reindex` command has already run the repository-docs builder. Report the following output in one concise line, then resume any active user task from immediately before this command. If there was no active task, stop after reporting the output.

!`ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"; NODE_PATH="$CONFIG/node_modules" node "$CONFIG/plugins/dev-core/tools/build-semantic-index.cjs" "$ROOT"`
