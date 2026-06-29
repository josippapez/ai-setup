---
name: agent-orchestration
description: Route tasks to the right subagent or Claude model tier based on task type, scope, and cost. Use when deciding whether to delegate coding, refactoring, file generation, tests, research, or validation to a faster/cheaper subagent, when planning/design/risk needs a stronger model, when choosing between generic subagents (Explore/Plan/general-purpose) and background subagents, or when grounding repo-specific work before delegating. Triggers include phrases like "delegate this", "spawn a subagent", "run in background", "use a cheaper model", "plan this out", "complex architecture decision", "safety-critical change", "model tier routing", and "explore the codebase". Main agent stays orchestrator and prompt-loop owner throughout.
---

# agent-orchestration

Use this skill to make delegation and model-tier decisions when launching
subagents through the built-in Agent tool. The main agent stays the orchestrator
and prompt-loop owner; subagents never talk to the user directly.

## Core orchestration rules

1. The main agent MUST remain the orchestrator and prompt-loop owner; subagents
   never talk to the user directly.
2. For mapped domains or clearly delegable work, the main agent MUST delegate
   unless the change is truly trivial.
3. Delegation prompts MUST include a full context pack in one message:
   objective, scope, constraints, validation commands, and handoff format (see
   Context forwarding — subagents do NOT inherit the main session's context).
4. For empty/partial output on the same unresolved objective, the main agent
   MUST follow up with the same agent first (continue it via its agent ID)
   before launching a new agent.
5. After follow-up, the main agent MAY relaunch at most one new agent for that
   same unresolved objective.
6. The main agent MUST NOT create recursive new-agent spawning loops for the
   same unresolved objective.
7. If no meaningful progress remains after allowed attempts, the main agent
   MUST stop delegating, execute directly, validate, and report why.
8. For independent work that can run while the main loop continues, the main
   agent SHOULD launch the Agent tool with `run_in_background: true` (see
   Background subagents).

## Model-tier-aware routing

The spawning main agent chooses each subagent's model tier by task complexity
and cost — it sets the tier when launching the subagent (a Claude tier only; an
agent's declared model is just a fallback). The skill gives the principle, not a
fixed table:

- Lean to a cheaper/faster tier for mechanical implementation (coding,
  refactoring, file generation, running tests, lint fixes).
- Lean to a stronger tier for planning, architecture, complex reasoning,
  ambiguity resolution, and safety-critical/security-sensitive work.
- Prefer the lowest tier that can do the job; escalate only when the task needs
  stronger reasoning, complex multi-file changes, or the lower tier fails after
  the allowed follow-up/relaunch.

Route by need to the matching generic subagent regardless of tier: read-heavy
fan-out search → `Explore`; design/planning → `Plan`; implementation or mixed
research → `general-purpose`; Claude Code / SDK / API questions →
`claude-code-guide`.

## Exceptions — do NOT delegate (or escalate regardless)

1. The change is trivial and takes under ~30 seconds — do it directly.
2. No suitable subagent fits the domain.
3. The user explicitly requested a specific model or agent — honor it.
4. The change is security-sensitive, safety-critical, or high-risk — use a
   stronger reasoning tier regardless of how mechanical the work looks.
5. The lower-tier agent already failed and the follow-up/relaunch limits are
   exhausted — execute directly and report why.

## Context forwarding

Subagents run in separate sessions and do NOT inherit the main session's
injected context (plugin-bundled rules, doc hints, the prompt-loop reminder).
When delegating, copy whatever the subagent needs into its prompt:

1. Any relevant doc paths surfaced this session (e.g. from the repo-grounding
   MCP tools below) in the delegation prompt's context section.
2. The exact validation/test commands for the target repo in the delegation
   prompt's validation commands section.

## Context-efficient grounding

Before delegating or answering repo-specific questions, prefer the
`interactive-mcp` plugin's repo-grounding tools over broad file reads or web
search — they cover repo docs, installed package versions, and
dependency/impact analysis. Use them to ground decisions in repo conventions
without loading large amounts of source into context, then forward what you find
(doc paths, versions) into the delegation prompt — subagents can ground
themselves too, but only with what you already surfaced.

## Background subagents

Use the Agent tool with `run_in_background: true` for fire-and-forget or
parallel work that can run while the main agent continues. The main agent is
notified when the subagent completes and collects its final output then.

Use background subagents for:

- Independent research, codebase exploration, or comparison tasks.
- Long-running audits, documentation reviews, validation sweeps, or browser
  checks.
- Parallel investigation while the main agent continues implementation.
- User-requested background review, especially with an explicit model or
  reasoning-effort request.

Do not use background subagents for:

- Work that must complete before the main agent can proceed.
- Tiny checks the main agent can finish faster.
- Multiple agents touching the same files unless scopes or batches are
  explicitly non-overlapping.

Required background-subagent workflow:

1. Launch the Agent tool with `run_in_background: true` and a bounded prompt
   that includes objective, scope, constraints, validation expectations, and
   final handoff format.
2. Pick the matching `subagent_type`; override `model` only when the task
   clearly needs a different tier.
3. Note the returned agent ID so the same agent can be continued for
   follow-ups instead of relaunching.
4. Rely on completion notifications to collect final results.
5. Review the child output, run any missing verification, and own the final
   handoff quality.

Background subagents MAY run in parallel only when their scopes do not share
state, output dependencies, or overlapping files. If a background subagent
stalls or fails, retry once with a refined prompt. If it fails again, continue
directly and report why.

## Background prompt template

```text
Objective: [one-sentence goal]

Scope: [files, projects, URLs, admin surfaces, or directories]

Constraints:
- [files to avoid]
- [prior decisions to honor]
- [ordering requirements]
- [non-overlap / batching rules]
- [whether edits are allowed]

Validation expected: [commands/checks/browser verification]

Handoff format: [findings, patch summary, validation result, open questions]
```

## Agents available in this setup

This Claude config ships no standalone domain specialists. Delegate to what
actually exists:

- **Generic subagents** via the Agent tool — `Explore` (read-only fan-out
  search), `Plan` (architecture/implementation plans), `general-purpose`
  (multi-step research or edits), `claude-code-guide` (Claude Code / SDK / API
  questions).
- **Any other skill surfaced via skill-discovery** — invoke whatever installed
  skill matches the task's domain.

Route by need rather than a fixed domain list: read-heavy → `Explore`;
design/planning → `Plan`; implementation or mixed research → `general-purpose`.

## References

- `prompt-user` skill — prompt-loop ownership rules.
- `agent-guidance-authoring` skill — authoring/maintaining this guidance.
