# Linear Orchestration Claude Plugin

Linear-backed task orchestration. On a non-trivial, multi-step task the main agent
grills it to a spec, sets up a **long-lived per-repo Linear project** with the **epic as a
milestone** and its **chunks as issues**, then dispatches **self-managing** `linear-worker`
subagents that build each chunk, run their own code-standards + review loop, and post their
own Linear updates; the orchestrator drives convergence and statuses to Done / partial /
abandoned. Everything is addressed by explicit ID passed top-down, so multiple repos/epics
run concurrently without collision.

## Layout

- `.mcp.json` bundles two self-contained MCP servers: the Linear MCP (`https://mcp.linear.app/mcp`, server name `linear`) and a **repo-docs** MCP (server name `repo-docs`, a local `node` runtime) exposing `find_docs`/`list_docs`/`read_doc`/`find_libs` + dependency-graph tools — both available on install. `find_docs` indexes every Markdown file in the repo (vendor/build dirs pruned) and blends keyword scoring (whole-word, length-normalized) with semantic embeddings. To exclude folders/files from indexing, add a gitignore-lite `<repo>/.claude/repo-docs-ignore` (one glob per line, `#` comments; a bare name excludes that subtree at any depth). Rebuild the semantic index any time with `/reindex`.
- `runtime/` — the bundled repo-docs MCP server, copied in so the plugin is self-contained (no dependency on any other plugin's MCP).
- `hooks/` — a SessionStart hook that installs the repo-docs MCP's npm dependency (`@huggingface/transformers`) into `CLAUDE_PLUGIN_DATA`. Separately, the repo-docs MCP pre-embeds the repo's Markdown in the background when it connects (fire-and-forget, incremental via an mtime cache) so the first `find_docs` doesn't pay the indexing cost; `/reindex` remains the explicit rebuild.
- `skills/` — `linear-orchestration` (the workflow) plus companion skills `grilling`, `domain-modeling`, `grill-with-docs`.
- `commands/` — `/linear-orchestration [task]`, an explicit slash-command handle that invokes the workflow skill (use when you'd rather trigger it directly than rely on skill-discovery); `/reindex [repo-root]`, which rebuilds the repo-docs semantic index for the current repo (re-embeds all Markdown — run after adding/editing docs); and `/repo-docs-ignore [paths]`, which shows/edits the `.claude/repo-docs-ignore` exclude list interactively and offers to reindex. Both require a Claude Code surface (CLI, IDE extension, or Cowork); plugin commands/skills/subagents do **not** run in the Claude Desktop *chat* app — only the bundled MCP servers do.
- `agents/` — `linear-worker` (builds a chunk, then spawns its own `code-standards-checker` + a tier-by-complexity `linear-reviewer`), plus `linear-reviewer` and `code-standards-checker`. Subagents post their own Linear updates via the MCP (attempt-then-relay; the orchestrator posts anything a subagent couldn't). The skill engages via skill-discovery (its `description`); the only hook is the SessionStart dependency-install step for the bundled repo-docs MCP — not an auto-engage hook. The `code-standards-checker` uses the bundled repo-docs MCP to discover and check the repo's standards/guides, not just the ACs.

## Design

The full design lives in the workflow skill: [`skills/linear-orchestration/SKILL.md`](skills/linear-orchestration/SKILL.md)
(phases, status map, self-managing workers, attempt-then-relay writes, project scoping, invariants).

## Prerequisites (one-time)

No local Linear app is required — the bundled MCP is Linear's hosted HTTP endpoint. You need:

1. A **Linear account + workspace** (cloud).
2. **Authorize the MCP**: the first time the `linear` server is used, Claude Code prompts an
   OAuth flow — approve it. Until authorized, the plugin warns and falls back to in-session
   todos (tracking won't persist). Check with `/mcp`.
3. **At least one team** in the workspace — the plugin does **not** require a specific team
   name. It routes each project to its own team (resolved per project across all teams; see
   `Project scoping`), so a project under e.g. `Side projects` keeps its work there. For a
   *new* project it prefers an `Ai agents` team if one exists, otherwise the single existing
   team (you're asked if there are several). The bundled MCP **cannot create teams** (no
   `teamCreate`; that needs a Linear API key via `@linear/sdk`, and there is no official CLI) —
   if the workspace has none, create one in Linear (Settings → Teams).
4. **(Recommended) A permission allow-rule** so worker/reviewer/checker subagents can post their
   own Linear updates in auto mode: add `"mcp__plugin_linear-orchestration_linear"` to
   `permissions.allow` in `settings.json`. Without it the auto-mode external-write classifier
   denies autonomous subagent writes, and the workflow falls back to relaying every update
   through the orchestrator (slower, but still correct).

## Avoiding duplicate Linear tools

If the official `linear@claude-plugins-official` plugin is also installed, both Linear MCP
servers load and you get duplicate tools. Disable one (this repo disables the official one in
`settings.json`).
