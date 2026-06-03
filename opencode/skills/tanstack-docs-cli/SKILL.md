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

List available TanStack libraries:

```sh
npx @tanstack/cli libraries --json
```

Search docs:

```sh
npx @tanstack/cli search-docs "server functions" --library start --json
npx @tanstack/cli search-docs "route head" --library router --framework react --json
```

Fetch a doc page:

```sh
npx @tanstack/cli doc query framework/react/overview --docs-version v5 --json
```

## Notes

- Use `--library router`, `--library start`, or another exact library id when known.
- Use `--framework react` or `--framework solid` when framework-specific behavior matters.
- If a doc query path is uncertain, search first, then fetch the best matching page.
