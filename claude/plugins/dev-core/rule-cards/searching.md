---
name: searching
description: Ask the code graph before grepping, and read installed source instead of assuming library internals.
requires: .codegraph
---

# Before you grep

This repo has a `.codegraph/` index: a pre-built graph of every symbol, call edge, and import, kept current by a file watcher.

One call, `codegraph explore "<symbol names or question>"` in the shell (or the `codegraph_explore` MCP tool), returns the verbatim line-numbered source of the relevant symbols grouped by file, plus the call path among them and a blast-radius summary of what depends on them. It follows dynamic-dispatch hops that grep cannot: callbacks, re-renders, JSX children.

Reach for it BEFORE Grep, Glob, and Read whenever the question is *where is X*, *how does X work*, *what calls X*, or *what breaks if I change X* — and before editing a shared symbol, so the blast radius is in view while you write. One call usually answers the whole thing; a grep-and-read loop repeats work the graph already did. Source it returns is a Read you already performed, so do not re-open those files.

Grep stays correct for a literal string sweep and for everything the graph does not index: Markdown, config, generated files.

Do not run `codegraph init` yourself. Indexing is the user's decision, unless a workflow you are running tells you to.
