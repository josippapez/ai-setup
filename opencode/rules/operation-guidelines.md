---
applyTo: '**'
name: operation-guidelines
description: General operation guidelines requiring tier-aware agent/model delegation and context-efficient repo grounding via interactive-mcp-standalone plugin tools.
---

# Operation guidelines

These guidelines apply to all operations.

## Tier-aware orchestration

The agent MUST consult the `agent-orchestration` skill and the `custom-orchestrator` agent for implementation and operation guidelines.

- Implementation and execution work (coding, refactoring, file generation, running tests, lint fixes) MUST be delegated to lower-tier/faster/cheaper agents or models when a suitable one exists.
- Planning, architecture, complex reasoning, ambiguity resolution, and safety-critical decisions SHOULD be routed to higher-tier/more expensive reasoning models.
- The main agent MUST remain the orchestrator and prompt-loop owner. Custom agents never talk to the user directly.
- Prefer free-tier subagents (`free-tier-coder`, `free-tier-explorer`) whenever they can handle the task satisfactorily. Escalate to paid tiers only when stronger reasoning, complex multi-file changes, or failure after retry requires it.

## Exceptions — tier-aware routing does not apply

The agent MUST NOT apply tier-aware routing in these cases:

1. The change is trivial and takes under ~30 seconds.
2. No suitable cheap/fast agent exists for the domain.
3. The user explicitly requests a specific model or agent.
4. The change is security-sensitive, safety-critical, or high-risk and requires depth regardless of implementation nature.
5. The cheap/fast agent has already failed and follow-up/relaunch limits are exhausted.

## Context-efficient grounding

The agent MUST rely heavily on the `interactive-mcp-standalone` plugin tools to ground answers in repo conventions without loading large amounts of source code into context:

- Repo docs: `find_docs`, `list_docs`, `read_doc`
- Package versions: `find_libs`
- Dependency and impact analysis: `get_file_dependencies`, `get_file_dependents`, `get_blast_radius`
- Graph readiness: `get_repository_index_status`
- Subagent spawning: use the native `task` tool in a TUI session; the `interactive-mcp-standalone` plugin is for repo grounding tools only.
- Persistent context: `manage_memories`

These tools are registered by the `interactive-mcp-standalone` plugin located at `~/.config/opencode/plugins/interactive-mcp/` (or `~/Desktop/ai-setup/opencode/plugins/interactive-mcp/` in the mirror). The agent SHOULD prefer these tools over broad file reads or web searches for repo-specific conventions.
