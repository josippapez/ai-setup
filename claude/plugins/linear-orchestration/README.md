# Orchestration Claude Plugin

Markdown-tracked task orchestration. On a non-trivial, multi-step task the main agent
grills it to a spec, scouts the repo into a **context pack** (read-only `repo-scout`
agent — quick pass before grilling, deep pass before decomposing), tracks the epic in a
**local git-ignored `.orchestration/` markdown store** — a **long-lived per-repo
`PROJECT.md`**, the **epic as `EPIC.md`**, and its **chunks as issue files** (and, for a
UI epic, a read-only `design-lead` produces an accessible, WCAG 2.2 A/AA design direction
before decomposing) — then dispatches **self-managing** `linear-worker` subagents that
build each chunk, run their own code-standards + review loop, and write their own updates
to the store; the orchestrator drives convergence and statuses to Done / partial /
abandoned. Everything is addressed by explicit absolute path passed top-down, so multiple
repos/epics run concurrently without collision. **No external service, account, or auth is
required** — tracking is plain files in the repo.

## The markdown store

- **Location:** `<repo-root>/.orchestration/`, created on first use with a self-ignoring
  `.orchestration/.gitignore` (`*`) so the whole store is untracked without touching the
  repo's root `.gitignore` (it's never committed). Addressed by **absolute path**, resolved at
  the main repo root and passed into every subagent — so a worker running in a git worktree
  still writes to the one canonical store.
- **`.gitignore`** — a single `*`, written when the store is created, so the entire
  `.orchestration/` tree stays out of git with no change to the repo's root `.gitignore`.
- **`PROJECT.md`** — long-lived per-repo container: product overview + the single
  "Progress / Resume here" section. Never deleted.
- **`<epic-slug>/EPIC.md`** — the epic: goal + acceptance criteria + a compact Context pack,
  plus (when they apply) the approved Design direction, ADRs, and accessibility scope.
- **`<epic-slug>/issues/NN-<slug>.md`** — one file per chunk: YAML frontmatter
  (`status` / `labels` / `complexity`), a `## Description` (the spec), and an append-only
  `## Comments` thread. The worker, its code-standards-checker, and its linear-reviewer all
  write into this one file — comments are **append-only** (`>>`, safe for the parallel
  reviewers), and the frontmatter `status:` is moved by a **single writer** (the worker on
  join, or the orchestrator at Converge) so a status change never races an append.

## Layout

- `.mcp.json` bundles two self-contained MCP servers: a **repo-docs** MCP (server name `repo-docs`, a local `node` runtime) exposing `find_docs`/`list_docs`/`read_doc`/`find_libs` + dependency-graph tools; and a **wcag** MCP (server name `wcag`, `npx -y wcag-guidelines-mcp`) exposing the WCAG 2.2 success criteria, techniques, and failures that the `design-lead` and `wcag-reviewer` agents ground accessibility in — both available on install. `find_docs` indexes every Markdown file in the repo (vendor/build dirs pruned) and blends keyword scoring (whole-word, length-normalized) with semantic embeddings. To exclude folders/files from indexing, add a gitignore-lite `<repo>/.claude/repo-docs-ignore` (one glob per line, `#` comments; a bare name excludes that subtree at any depth). Rebuild the semantic index any time with `/reindex`.
- `runtime/` — the bundled repo-docs MCP server, copied in so the plugin is self-contained (no dependency on any other plugin's MCP).
- `hooks/` — a SessionStart hook that installs the repo-docs MCP's npm dependency (`@huggingface/transformers`) into `CLAUDE_PLUGIN_DATA`. Separately, the repo-docs MCP pre-embeds the repo's Markdown in the background when it connects (fire-and-forget, incremental via an mtime cache) so the first `find_docs` doesn't pay the indexing cost; `/reindex` remains the explicit rebuild.
- `skills/` — `linear-orchestration` (the workflow) plus companion skills `grilling`, `domain-modeling`, `grill-with-docs`.
- `commands/` — `/linear-orchestration [task]`, an explicit slash-command handle that invokes the workflow skill (use when you'd rather trigger it directly than rely on skill-discovery); `/reindex [repo-root]`, which rebuilds the repo-docs semantic index for the current repo (re-embeds all Markdown — run after adding/editing docs); and `/repo-docs-ignore [paths]`, which shows/edits the `.claude/repo-docs-ignore` exclude list interactively and offers to reindex. All require a Claude Code surface (CLI, IDE extension, or Cowork); plugin commands/skills/subagents do **not** run in the Claude Desktop *chat* app — only the bundled MCP servers do.
- `agents/` — `repo-scout` (read-only exploration; returns the context pack that grounds grilling, the council, and chunk file-scopes, and whose slices go into each issue spec), `council-member` (one voice in the architecture council: argues ONE delegated decision through ONE assigned lens, returns a strict-JSON proposal the orchestrator synthesizes), `design-lead` (read-only UI design lead; for a UI epic returns a design pack — direction, token map, component-reuse plan, WCAG 2.2 A/AA baseline — grounded in the bundled `wcag` MCP, accessible by default), `linear-worker` (builds a chunk, runs a docs self-check for stale owning docs, then spawns its own `code-standards-checker` + a tier-by-complexity `linear-reviewer`), plus `linear-reviewer`, `code-standards-checker`, `wcag-reviewer` (WCAG 2.2 A/AA audit of the integrated UI at convergence for UI epics), and `docs-maintainer`. Subagents write their own updates to the markdown store (append-only comments; attempt-then-relay, so the orchestrator applies anything a subagent couldn't). The skill engages via skill-discovery (its `description`); the only hook is the SessionStart dependency-install step for the bundled repo-docs MCP — not an auto-engage hook. The `code-standards-checker` uses the bundled repo-docs MCP to discover and check the repo's standards/guides, not just the ACs.

## Design

The full design lives in the workflow skill: [`skills/linear-orchestration/SKILL.md`](skills/linear-orchestration/SKILL.md)
(phases, status map, self-managing workers, append-only writes + single-writer status,
store scoping, invariants).

### Why a local markdown store

Tracking is plain files under `.orchestration/` in the repo, git-ignored so orchestration
chatter never lands in commits. This keeps the plugin **fully autonomous and zero-setup** —
no account, no OAuth, no per-workspace ticket quota, and no network dependency: the store is
created on first use and read back on resume. The shape mirrors a tracker (a long-lived
per-repo `PROJECT.md`, the epic as `EPIC.md`, chunks as issue files with a description +
comment thread) so the same worker → checker + reviewer flow works unchanged; only the
medium is different. Because the store lives at the main repo root and is addressed by
absolute path, workers isolated in git worktrees still write to the one canonical store.

## Prerequisites (one-time)

None. The store is created automatically on first use and git-ignored; there is nothing to
install, authorize, or configure. (If the filesystem is read-only and the store can't be
created, the workflow warns and falls back to in-session todos — tracking won't persist.)

The bundled MCP servers still apply: the `repo-docs` MCP installs its embedding dependency on
first SessionStart, and the `wcag` MCP fetches `wcag-guidelines-mcp` via `npx` on first use.
Check either with `/mcp`.
