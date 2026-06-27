# Linear Orchestration Claude Plugin

Linear-backed task orchestration. On a non-trivial, multi-step task the main agent
grills it to a spec, decomposes it into a per-repo Linear project (parent issue +
self-contained sub-issues), dispatches `linear-worker` / `linear-reviewer` subagents
per chunk, and drives statuses to Done / partial / abandoned.

## Layout

- `.mcp.json` bundles the Linear MCP (`https://mcp.linear.app/mcp`, server name `linear`) — available on install.
- `skills/` — `linear-orchestration` (the workflow) plus companion skills `grilling`, `domain-modeling`, `grill-with-docs`.
- `agents/` — `linear-worker` and `linear-reviewer` (both read-only on Linear; the orchestrator performs all writes).
- `hooks/` — a `UserPromptSubmit` hook (`auto-engage.sh`) that injects the engage directive on every prompt.

## Design

The full design lives in the workflow skill: [`skills/linear-orchestration/SKILL.md`](skills/linear-orchestration/SKILL.md)
(phases, status map, relayed-write model, project scoping, invariants).

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

## Avoiding duplicate Linear tools

If the official `linear@claude-plugins-official` plugin is also installed, both Linear MCP
servers load and you get duplicate tools. Disable one (this repo disables the official one in
`settings.json`).
