---
description: Configure which folders/files repo-docs excludes from find_docs indexing. Shows the current .claude/repo-docs-ignore, asks what to exclude, writes it, and offers to reindex.
argument-hint: "[optional paths/globs to exclude]"
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Configure repo-docs ignore

Manage this repository's `.claude/repo-docs-ignore` — the gitignore-lite list of paths the bundled **repo-docs** MCP excludes from `find_docs` / `list_docs` indexing. Use it to keep auto-generated reports, fixtures, or vendored docs out of doc search.

Do exactly these steps, then stop:

1. Resolve the repo root with `git rev-parse --show-toplevel` (fall back to the current directory). The config file is `<root>/.claude/repo-docs-ignore`.
2. Read the current file if it exists and show the user its patterns; if there's none yet, say so.
3. Decide what to exclude:
   - If the user provided paths/globs in the arguments below, use those.
   - Otherwise **ask the user** which folders/files/globs to exclude, and whether to **add to** or **replace** the existing list. Offer likely candidates you can actually see in this repo (e.g. large auto-generated report directories, test fixtures, vendored/mirror docs) — but never exclude anything the user didn't confirm.
4. Write/update `<root>/.claude/repo-docs-ignore` in gitignore-lite format: one pattern per line, `#` comments allowed. A bare name (e.g. `evidence`) excludes that subtree at any depth; `*` matches within a path segment, `**` across segments.
5. Show the final file contents and confirm with the user.
6. Note that excludes take effect on the next index build, and offer to run `/reindex` now. If the user agrees, invoke it.

Arguments (paths/globs to exclude, optional): $ARGUMENTS

Keep the file minimal and only reflect what the user confirmed.
