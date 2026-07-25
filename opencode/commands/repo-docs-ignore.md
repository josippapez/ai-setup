---
description: Configure Markdown paths excluded from repository-docs indexing.
---

# Configure repository-docs ignore

Manage this repository's `.opencode/repo-docs-ignore`, the gitignore-lite list excluded from `interactive-mcp-standalone_find_docs` and `interactive-mcp-standalone_list_docs`.

Do exactly these steps:

1. Resolve the repository root with `git rev-parse --show-toplevel`, falling back to the current directory. Use `<root>/.opencode/repo-docs-ignore`.
2. Read and show the existing patterns, or state that none exist.
3. If `$ARGUMENTS` contains paths or globs, use those. Otherwise use the native `question` tool to ask what to exclude and whether to add to or replace the current list. Suggest only visible generated, fixture, vendor, or report paths and never exclude an unconfirmed path.
4. Write one pattern per line; `#` comments are allowed, `*` matches within a path segment, and `**` matches across segments.
5. Show the final contents and confirm them with the user.
6. Explain that the next index build applies the exclusions and offer `/reindex` now.

Keep the file minimal and reflect only confirmed exclusions.
