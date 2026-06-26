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
3. A team named **`Ai agents`** in that workspace (the default team for `list_projects` /
   `save_project`). Create it in Linear if absent, or change the `Team` default in the skill's
   `Defaults` section.

## Avoiding duplicate Linear tools

If the official `linear@claude-plugins-official` plugin is also installed, both Linear MCP
servers load and you get duplicate tools. Disable one (this repo disables the official one in
`settings.json`).
