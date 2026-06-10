---
name: opensrc
description: Use when you need to read library source code to understand internals, debug behaviour, or verify an API exists in the installed version. Resolves to a local cached path via `npx opensrc path <pkg>`.
---

# opensrc — Source Code Lookup

`opensrc` fetches and caches the full source code of any npm/PyPI/crates.io package keyed by its exact installed version, then returns a local directory path you can explore with shell tools.

## When to use

- You are about to assume how a library works internally (hooks, events, types)
- A library is behaving unexpectedly and you need to read the actual implementation
- You need to check whether a feature or option exists in the installed version (not a newer one documented online)
- `context7` only has docs, but you need source-level detail

## Command

```bash
npx opensrc path <package>          # npm package (e.g. zod, msw, @tanstack/react-table)
npx opensrc path pypi:<package>     # PyPI package
npx opensrc path crates:<crate>     # crates.io crate
npx opensrc path github:<owner>/<repo>  # GitHub repo
```

Returns a local path like `~/.opensrc/repos/github.com/<owner>/<repo>/<version>/`.
Second call is instant (cached).

## Common patterns for this repo

```bash
# Browse storybook addon source (exact installed version)
ls $(npx opensrc path @storybook/addon-vitest 2>/dev/null)

# Find how an option is handled in TanStack Table
grep -r "getCoreRowModel" $(npx opensrc path @tanstack/react-table 2>/dev/null)/src

# Read MSW handler types
cat $(npx opensrc path msw 2>/dev/null)/src/core/handlers/RequestHandler.ts

# Check TanStack Router's Link props
grep -r "LinkProps" $(npx opensrc path @tanstack/react-router 2>/dev/null)/src | head -20

# Inspect vitest browser config options
ls $(npx opensrc path @vitest/browser 2>/dev/null)
```

## Rules

- Always suppress the npx install noise with `2>/dev/null` when using in subshell `$()`
- Use the path as a read-only root — do not write to the cache
- After fetching a path, prefer `grep -r`, `find`, or `cat` over spawning a full Explore agent (source is already local)
- If the package is a monorepo, the path points to the specific sub-package, not the repo root
