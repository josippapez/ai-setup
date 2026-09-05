---
applyTo: "**"
name: codegraph
description: In a repository that has a .codegraph/ index, ask the code graph before grepping or reading files - one codegraph_explore call returns a symbol's verbatim source plus its callers, callees, and blast radius. Never run codegraph init yourself.
---

# CodeGraph — ask the graph before reading files

Applies **only** in a repository with a `.codegraph/` directory at its root. There, CodeGraph holds a pre-built graph of every symbol, call edge, and import, kept current by a file watcher.

Two entry points, same output:

- **MCP tool** `codegraph_explore` (full name `mcp__plugin_repo-docs_codegraph__codegraph_explore`). It is a deferred tool, so load it by name with tool search before the first call.
- **Shell**, always available: `codegraph explore "<symbol names or question>"`.

Reach for it BEFORE Grep/Glob/Read whenever the question is *where is X*, *how does X work*, *what calls X*, or *what breaks if I change X* — and before editing a shared symbol, so the blast radius is in view while you write. Query it with a question or a bag of symbol and file names. One call usually answers the whole thing; a grep-and-read loop repeats work the graph already did.

Source it returns is the current on-disk source, line-numbered. Treat it as a Read you already performed and do not re-open those files.

Grep remains correct for a literal string sweep and for everything the graph does not index: Markdown, config, generated files.

**No `.codegraph/` directory means the repo is not indexed.** Use the built-in tools and say so if it matters. Do not run `codegraph init` yourself — indexing is the user's decision — **unless a workflow you are running tells you to**. The `orchestrate` and `orchestrate-nightly` skills do exactly that at their Gate, because starting an orchestration is itself the opt-in.
