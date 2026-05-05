---
applyTo: '**'
name: documentation-and-patterns
description: Reusable documentation lookup and pattern-following workflow.
---

# Documentation And Patterns

Use local repository guidance before inventing new patterns.

## Documentation lookup order

1. Check local repository docs first, especially `README.md`, `docs/guides`, `docs/standards`, and `docs/patterns` when present.
2. If external package behavior is relevant and local docs are absent or stale, use authoritative external docs.
3. Prefer version-specific external docs based on `package.json`, lockfiles, or an explicit user-provided version.
4. If the user provides a documentation link, treat that link as the primary source.

## Pattern usage

- Follow established file structure, naming, test, accessibility, styling, and API patterns in the target repository.
- Read relevant pattern docs before implementing non-trivial features.
- If code changes invalidate docs, update the affected docs in the same task.
- Mention assumptions when exact package versions or documentation sources are uncertain.

## TanStack docs

- For TanStack libraries, use the TanStack CLI docs when available.
- Always request machine-readable output such as `--json` when the CLI supports it.
