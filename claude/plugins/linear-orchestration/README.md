# Linear Orchestration Claude Plugin

Linear-backed task orchestration. On a non-trivial, multi-step task the main agent
grills it to a spec, sets up a per-repo Linear project (the epic) with **milestones**
(phases) and self-contained **issues** (chunks), then dispatches **self-managing**
`linear-worker` subagents that build each chunk, run their own code-standards + review
loop, and post their own Linear updates; the orchestrator drives convergence and statuses
to Done / partial / abandoned. Everything is addressed by explicit ID passed top-down, so
multiple projects can run concurrently without collision.

## Layout

- `.mcp.json` bundles the Linear MCP (`https://mcp.linear.app/mcp`, server name `linear`) — available on install.
- `skills/` — `linear-orchestration` (the workflow) plus companion skills `grilling`, `domain-modeling`, `grill-with-docs`.
- `agents/` — `linear-worker` (builds a chunk, then spawns its own `code-standards-checker` + a tier-by-complexity `linear-reviewer`), plus `linear-reviewer` and `code-standards-checker`. Subagents post their own Linear updates via the MCP (attempt-then-relay; the orchestrator posts anything a subagent couldn't). The skill engages via skill-discovery (its `description`) — there is no auto-engage hook.

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
