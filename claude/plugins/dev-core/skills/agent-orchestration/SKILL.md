---
name: agent-orchestration
description: 'Route tasks to the right subagent or Claude model tier based on task type, scope, and cost. The main agent stays orchestrator and prompt-loop owner throughout.'
when_to_use: 'Triggers: "delegate this", "spawn a subagent", "run in background", "use a cheaper model", "which model for this", "plan this out", "complex architecture decision", "safety-critical change", "model tier routing", "explore the codebase", "run these in parallel". Use when deciding whether to hand coding, refactoring, file generation, tests, research, or validation to a faster or cheaper subagent, when planning, design, or risk work needs a stronger model, and when choosing between generic subagents (Explore/Plan/general-purpose), repo custom agents (tier and coder agents, domain specialists like docs-maintainer or wcag-a11y-aa-specialist), and background subagents.'
---

# agent-orchestration

Use this skill to make delegation and model-tier decisions when launching
subagents through the built-in Agent tool. The main agent stays the orchestrator
and prompt-loop owner; subagents never talk to the user directly, apart from the
one carve-out below.

## Core orchestration rules

1. The main agent MUST remain the orchestrator and prompt-loop owner. Each side
   of the boundary has exactly one way to ask:
   - **Main agent: always the built-in `AskUserQuestion`.** Never the
     `interactive` MCP, even though it is registered and callable.
   - **Subagents: always `request_user_input` from the `interactive` MCP.**
     Claude Code withholds `AskUserQuestion` from subagents, so that is their
     only route, and they use it only when blocked on something only the user
     can answer (a missing credential, a choice between valid options, a
     requirement the task never stated).

   Progress, findings, and scope changes still come back to the orchestrator
   rather than going to the user.
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
   same unresolved objective. This bans re-spawning against the SAME
   unresolved objective — it does NOT forbid a bounded, single-level
   delegation where a spawned subagent dispatches its own reviewers/checkers
   for a DIFFERENT objective (e.g. an orchestration worker spawning its own
   code-standards-checker + reviewer to review what it built). **Whether a
   subagent CAN spawn depends on config, not on the objective:** as of Claude
   Code v2.1.217 nested spawning is **OFF by default** — a subagent does not
   receive the `Agent` tool unless `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` is set
   (this repo sets it to `2` in `settings.json`, which is what lets a worker
   spawn its reviewers; when enabled, nesting is capped at depth 5). So: with
   the env var set, a spawned worker CAN spawn its reviewers; if it's unset, the
   subagent genuinely lacks the spawn tool (only `TaskStop`/`SendMessage`/
   `EnterWorktree` surface) and must relay the work to the orchestrator rather
   than retry — that's the real platform default, not a bug.
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
`claude-code-guide`. When you want a role-tagged agent that already carries a
sensible default tier, dispatch one of the tier/coder agents or domain
specialists listed under Agents available.

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
`repo-docs` plugin's grounding tools over broad file reads or web
search — they cover repo docs, installed package versions, and
dependency/impact analysis. `repo-docs` must be installed alongside `dev-core`
(`claude/install.sh` does this automatically); if its `mcp__plugin_repo-docs_repo-docs__*`
tools are not callable, tell the user to run `claude plugin install repo-docs@ai-setup`.
Use them to ground decisions in repo conventions without loading large amounts of
source into context, then forward what you find (doc paths, versions) into the
delegation prompt — subagents can ground themselves too, but only with what you
already surfaced.

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

The `dev-core` plugin ships these custom agents — dispatch via the Agent
tool's `subagent_type`. The orchestrator sets the model tier at dispatch; each
agent's frontmatter `model` is only a fallback default.

**Tier/coder agents** — generic implementation at a chosen tier:

- `top-tier-reasoner` (opus) — architecture, complex design, ambiguity,
  safety-/security-critical.
- `high-tier-coder` (opus) — complex implementation and multi-file refactors.
- `mid-tier-coder` (sonnet) — everyday implementation and routine fixes.
- `low-tier-fast` (haiku) — quick edits, simple refactors, small tasks.
- `free-tier-coder` (haiku) — small, explicit, well-defined coding tasks.
- `free-tier-maintainer` (haiku) — docs, hygiene, config tweaks, lightweight sync.
- `free-tier-explorer` (haiku) — exploration, research, background context.

**Domain specialists:**

- `docs-maintainer` (sonnet) — keep owning docs/rules/skills aligned with changes.
- `self-improve-specialist` (sonnet) — durable behavior/guidance changes across
  rules + skills.
- `wcag-a11y-aa-specialist` (sonnet) — WCAG 2.2 A/AA audit and remediation.

The `orchestrate` plugin's workflow skill is authoritative for its specialists: precomputed non-empty slices dispatch standards/quality/docs gates, solution-reuse research is conditional and pre-worker, and implementation-quality review blocks only substantive source changes. Empty predicates are recorded skips, never fabricated passes.

Also available: the built-in generic subagents — `Explore` (read-only fan-out
search), `Plan` (architecture/implementation plans), `general-purpose`
(multi-step research or edits), `claude-code-guide` (Claude Code / SDK / API
questions) — plus any skill surfaced via skill-discovery.

## References

- `agent-guidance-authoring` skill — authoring/maintaining this guidance.
