---
name: tanstack-docs-cli
description: Use the TanStack CLI to find TanStack documentation. Use when working with TanStack Router, Start, Query, Form, Table, Store, DB, or other TanStack libraries; triggers include "TanStack docs", "router docs", "start docs", "query docs", and requests to check current TanStack behavior.
---

# TanStack Docs CLI

Use this skill whenever TanStack library behavior or documentation is relevant.

## Required Flow

1. Prefer local project docs first when the repository has relevant guidance.
2. For external TanStack documentation, use `npx @tanstack/cli` instead of web search.
3. Always pass `--json` so results are machine-readable.
4. Prefer version-specific docs when the project package version or user request identifies a version.

## Commands

**List libraries:**

```sh
npx @tanstack/cli libraries --json
```

**Search docs** — `search-docs` takes `--library` / `--framework` **flags**:

```sh
npx @tanstack/cli search-docs "route head" --library router --framework react --json
```

**Fetch a doc page** — `doc` takes two **positional** args `<library> <path>` and does NOT accept `--library`/`--framework` (passing them errors with `unknown option '--library'`). `<library>` is the library id (`router`, `query`, `table`, …); `<path>` is everything after `/docs/` in the page URL.

```sh
# signature: npx @tanstack/cli doc <library> <path> [--docs-version <v>] --json
npx @tanstack/cli doc router installation/with-vite --json
npx @tanstack/cli doc router api/file-based-routing --json
npx @tanstack/cli doc query framework/react/overview --json   # "query" here is the LIBRARY, not a verb
```

> Gotcha: `doc query …` fetches the TanStack **Query** docs (library = `query`). There is no `query` subcommand. For Router use `doc router …`.

## Finding the `<path>` for `doc`

Search first, then read the best hit's `url`: the first path segment is `<library>`, and everything after `/docs/` (minus any `#anchor`) is `<path>`.
`https://tanstack.com/router/latest/docs/installation/with-vite#…` → `doc router installation/with-vite`.

Router paths have no `framework/react/` prefix (e.g. `installation/with-vite`, `routing/file-based-routing`, `api/file-based-routing`); some libraries' paths do (e.g. `query framework/react/overview`) — always derive it from the URL.

## JSON shapes & parsing

Parse with `node` (brittle `jq` / `json -a` one-liners tend to return empty here).

- `search-docs` → `{ query, totalHits, results: [{ title, url, snippet, library, breadcrumb }] }`. `snippet` is HTML with highlight spans — strip tags if displaying.

  ```sh
  npx @tanstack/cli search-docs "loaders" --library router --json \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s).results.forEach(r=>console.log(r.title,'—',r.url)))"
  ```

- `doc` → `{ title, content, url, library, version }`. The page markdown is in `content`.

  ```sh
  npx @tanstack/cli doc router installation/with-vite --json \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).content))"
  ```

## Notes

- `doc` = positional `<library> <path>`; `search-docs` / `libraries` = `--library`/`--framework` flags. Don't mix them up.
- If a doc path is uncertain, search first, then fetch the best matching page.
- Don't confuse this docs tool with `@tanstack/router-cli` (`tsr generate`/`tsr watch`): that's unrelated to docs and is only for generating the route tree when NOT using a supported bundler — Vite/Rspack/Webpack/Esbuild use the `@tanstack/router-plugin` instead.
