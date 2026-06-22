---
name: agent-orchestration
description: Route tasks to repository custom agents and background subagents based on task type, scope, and parallelization needs. Main agent acts as orchestrator and prompting loop owner throughout.
---

# agent-orchestration

Use this skill to decide when and how to delegate to repository custom agents
or background subagents launched through the built-in Agent tool.

## Core rules

1. The main agent MUST remain the orchestrator and prompt-loop owner; custom
   agents never talk to the user directly.
2. For mapped domains, the main agent MUST delegate unless the change is truly
   trivial.
3. Custom-agent launches MUST set an explicit high-tier reasoning model by
   default (`gpt-5.3-codex`, `claude-sonnet-4.6`, or `claude-opus-4.6`).
4. Fast/cheap models (`*-mini`, `*-haiku`) MAY be used only when the user
   explicitly prefers speed/cost over depth.
5. Delegation prompts MUST include a full context pack in one message:
   objective, scope, constraints, validation commands, and handoff format.
6. For empty/partial output on the same unresolved objective, the main agent
   MUST follow up with the same agent first (continue it via its agent ID)
   before launching a new agent.
7. After follow-up, the main agent MAY relaunch at most one new agent for that
   same unresolved objective.
8. The main agent MUST NOT create recursive new-agent spawning loops for the
   same unresolved objective.
9. If no meaningful progress remains after allowed attempts, the main agent
   MUST stop delegating, execute directly, validate, and report why.
10. For independent background work, the main agent SHOULD launch the Agent
    tool with `run_in_background: true` so the main loop can continue while
    the subagent works.

## Context forwarding

Sub-agents run in separate sessions and do NOT inherit the main agent's CLI
extensions (`docs-recommender`, `test-reminder`, `prompt-loop`). Therefore:

1. The main agent MUST include any doc paths received via `docs-recommender`
   `additionalContext` in the delegation prompt's context section.
2. The main agent MUST include `pnpm exec nx test <project>` commands received via
   `test-reminder` context in the delegation prompt's validation commands
   section.

## Background subagents

Use the Agent tool with `run_in_background: true` for fire-and-forget or
parallel work that can run while the main agent continues. The main agent is
notified when the subagent completes and collects its final output then.

Use background subagents for:

- Independent research, codebase exploration, or comparison tasks.
- Long-running audits, documentation reviews, validation sweeps, or browser
  checks.
- Parallel investigation while the main agent continues implementation.
- User-requested background review, especially with explicit model or reasoning
  requests such as `gpt-5.5 xhigh`.

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

## Agent mapping

- `hcp-frontend-specialist` → frontend implementation/refactors.
- `nx-test-specialist` → test creation/refactoring.
- `docs-maintainer` → docs synchronization.
- `fe-guardrails-auditor` → FE guardrails remediation.
- `wcag-a11y-aa-specialist` → WCAG 2.2 A/AA audits/fixes.
- `figma-layout-token-analyst` → Figma analysis and token mapping.
- `dockerfile-specialist` → Dockerfile hardening and verification.
- `self-improve-specialist` → behavior/workflow changes (skills, instructions, docs).

## References

- `prompt-user` skill — prompt-loop ownership rules.
- `agent-guidance-authoring` skill — authoring/maintaining this guidance.
