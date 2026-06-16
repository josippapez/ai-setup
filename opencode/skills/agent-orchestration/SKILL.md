---
name: agent-orchestration
description: Route tasks to the right agent or model tier based on task type, scope, and cost. Use when deciding whether to delegate coding, refactoring, file generation, tests, or validation to a cheaper/faster agent or model, when complex reasoning, design, or risk assessment requires a stronger model, or when choosing between the built-in tiered subagents and repo-specific custom agents. Triggers include phrases like "delegate this", "use a cheaper model", "route to fast agent", "plan this out", "complex architecture decision", "safety-critical change", "model tier routing", and "spawn a subagent".
---

# agent-orchestration

Use this skill to make model-tier-aware delegation decisions. The main agent remains the orchestrator and prompt-loop owner; custom agents never talk to the user directly.

## Core orchestration rules

1. The main agent MUST remain the orchestrator and prompt-loop owner; custom agents never talk to the user directly.
2. For mapped domains, the main agent MUST delegate unless the change is truly trivial.
3. Delegation prompts MUST include a full context pack in one message: objective, scope, constraints, validation commands, and handoff format.
4. For empty/partial output on the same unresolved objective, the main agent MUST follow up with the same agent first before launching a new agent.
5. After follow-up, the main agent MAY relaunch at most one new agent for that same unresolved objective.
6. The main agent MUST NOT create recursive new-agent spawning loops for the same unresolved objective.
7. If no meaningful progress remains after allowed attempts, the main agent MUST stop delegating, execute directly, validate, and report why.

## Model-tier-aware routing

- Implementation and execution work (coding, refactoring, file generation, running tests, lint fixes) MUST be delegated to a lower-tier/faster/cheaper agent or model when a suitable one exists.
- Planning, architecture, complex reasoning, ambiguity resolution, and safety-critical decisions SHOULD be routed to a higher-tier/more expensive reasoning model.
- Default to the built-in tiered subagents when they fit:
  - `top-tier-reasoner` — architecture, complex design, ambiguity resolution, safety-critical decisions.
  - `high-tier-coder` — complex implementation and multi-file refactors.
  - `mid-tier-coder` — everyday implementation tasks and routine fixes.
  - `low-tier-fast` — quick edits, simple refactors, and small tasks.
  - `free-tier-explorer` — exploration, research, and low-priority background tasks.
- Prefer the native `task` tool for spawning subagents in a TUI session so they appear in the subagent UI and can be switched to.
- Use the `manage_background_subagents` MCP tool only for non-TUI/API background work where TUI visibility is not required.

## Exceptions — do NOT apply tier-aware routing

1. The change is trivial and takes under ~30 seconds.
2. No suitable cheap/fast agent exists for the domain.
3. The user explicitly requests a specific model or agent.
4. The change is security-sensitive, safety-critical, or high-risk and requires depth regardless of implementation nature.
5. The cheap/fast agent has already failed and follow-up/relaunch limits are exhausted.

## Context forwarding

Sub-agents run in separate sessions and do NOT inherit the main agent's CLI extensions or context. Therefore:

1. Include any doc paths or additional context received via repo tools in the delegation prompt's context section.
2. Include relevant validation commands (e.g., `pnpm exec nx test <project>`) in the delegation prompt.
3. When working in the Sciensus NX monorepo, also consider the repo-specific specialist agents: `hcp-frontend-specialist`, `nx-test-specialist`, `docs-maintainer`, `fe-guardrails-auditor`, `dependency-update-specialist`, `wcag-a11y-aa-specialist`, `figma-layout-token-analyst`, `dockerfile-specialist`, and `self-improve-specialist`.

## Context-efficient grounding

Before delegating or answering repo-specific questions, the main agent MUST prefer `interactive-mcp-standalone` plugin tools over broad file reads or web searches:

- Repo docs: `find_docs`, `list_docs`, `read_doc`
- Package versions: `find_libs`
- Dependency and impact analysis: `get_file_dependencies`, `get_file_dependents`, `get_blast_radius`
- Graph readiness: `get_repository_index_status`
- Background work and coordination: `manage_background_subagents`, `message_background_subagent`
- Persistent context: `manage_memories`

These tools are registered by the `interactive-mcp-standalone` plugin in `~/.config/opencode/plugins/interactive-mcp/` (or `~/Desktop/ai-setup/opencode/plugins/interactive-mcp/` in the mirror). Use them to ground decisions in repo conventions without loading large amounts of source code into context.

## References

- `agents/custom-orchestrator.md`
- `rules/operation-guidelines.md`
- `agents/top-tier-reasoner.md`
- `agents/high-tier-coder.md`
- `agents/mid-tier-coder.md`
- `agents/low-tier-fast.md`
- `agents/free-tier-explorer.md`
