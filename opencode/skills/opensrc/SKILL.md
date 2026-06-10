---
name: opensrc
description: Fetch and read library source code before assuming internals. Use when debugging library behaviour, verifying an API exists in the installed version, or when docs alone aren't enough.
---

# opensrc — Library Source Lookup

`opensrc` fetches and caches the full source code of any npm/PyPI/crates.io package keyed to its exact installed version, then returns a local path you can explore with standard shell tools.

## When to use

- Before assuming how a library works internally (hooks, events, option shapes)
- When a library behaves unexpectedly and you need to read the actual implementation
- When you need to verify an option or feature exists in the **installed** version, not a newer one described in online docs
- When `context7` only has high-level API docs but you need source-level detail

## Command

```bash
npx opensrc path <package>              # npm (e.g. zod, react, @tanstack/react-table)
npx opensrc path pypi:<package>         # PyPI
npx opensrc path crates:<crate>         # crates.io
npx opensrc path github:<owner>/<repo>  # GitHub repo
```

Returns a path like `~/.opensrc/repos/github.com/<owner>/<repo>/<version>/`.
Second and subsequent calls are instant (cached by version).

## Usage patterns

```bash
# Get the path and inspect the source
PKG=$(npx opensrc path zod 2>/dev/null)
ls "$PKG/src"
cat "$PKG/src/types.ts" | head -50

# Search for a specific option or function
grep -r "safeParse" $(npx opensrc path zod 2>/dev/null)/src | head -20

# Find how an event is typed
grep -r "RequestHandler" $(npx opensrc path msw 2>/dev/null)/src

# List all exports of a sub-package
ls $(npx opensrc path @tanstack/react-table 2>/dev/null)/src
```

## Rules

- Always suppress install noise with `2>/dev/null` when using in a subshell `$()`
- Use the returned path as read-only — do not write to the cache
- Prefer direct `grep`/`cat` over spawning an Explore agent — the source is already local
- For monorepo packages, the path resolves to the specific sub-package, not the repo root
