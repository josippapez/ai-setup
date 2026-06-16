---
name: agent-orchestration-v2
description: Route implementation and execution work to lower-tier/faster/cheaper agents and models while reserving higher-tier reasoning models for planning, architecture, ambiguity resolution, and safety-critical decisions. Use when deciding whether to delegate coding, refactoring, file generation, tests, or validation to a cheaper agent, or when complex reasoning, design, or risk assessment requires a stronger model. Triggers include phrases like "optimize cost", "use a cheaper model", "delegate implementation", "route to fast agent", "plan this out", "complex architecture decision", "safety-critical change", and "model tier routing".
---

# agent-orchestration-v2

Use this skill to make model-tier-aware delegation decisions. The main agent remains the orchestrator and prompt-loop owner; custom agents never talk to the user directly.

## Core routing

- Implementation work (coding, refactoring, file generation, test execution, lint fixes) MUST be delegated to a lower-tier/faster/cheaper agent or model when a suitable one exists.
- Planning, architecture, complex reasoning, ambiguity resolution, and safety-critical decisions SHOULD be routed to a higher-tier/more expensive reasoning model.
- The main agent MUST retain ownership of the prompt loop, scope confirmation, and final handoff quality.

## Exceptions — do NOT apply tier-aware routing

1. The change is trivial and takes under ~30 seconds.
2. No suitable cheap/fast agent exists for the domain.
3. The user explicitly requests a specific model or agent.
4. The change is security-sensitive, safety-critical, or high-risk and requires depth regardless of implementation nature.
5. The cheap/fast agent has already failed and follow-up/relaunch limits are exhausted.

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

- `agent/custom-orchestrator.agent.md`
- `rules/operation-guidelines.md`
- `skills/agent-orchestration/SKILL.md`
