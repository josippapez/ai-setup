@RTK.md

## CLI tools

- `opensrc` — fetch library source code locally: `npx opensrc path <pkg>` returns a cached local path for the exact installed version; use grep/cat/find to inspect internals. See `opensrc` rule for usage. Prefer this over assuming library behaviour when `context7` docs aren't enough.
- `codegraph` — in a repo with a `.codegraph/` directory, ask the code graph instead of grepping: `codegraph_explore` (MCP, deferred — load it by name with tool search first) or `codegraph explore "<symbols or question>"` returns a symbol's verbatim source plus its callers, callees, and blast radius in one call. Prefer it over Grep/Read for "where is X", "how does X work", "what calls X", and "what breaks if I change X"; treat returned source as already read. No `.codegraph/` directory means the repo is not indexed: use the built-in tools, and never run `codegraph init` yourself. See the `codegraph` rule for the full version.
