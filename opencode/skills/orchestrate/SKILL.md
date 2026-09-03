---
name: orchestrate
description: Orchestrate non-trivial multi-step work through a local markdown store and conditional specialist agents. Use for multi-file work, tasks needing decomposition, tracked epics, or explicit "track this" / "orchestrate this" requests, and to resume an existing `.orchestration` epic. The main agent owns the user loop and state machine.
---

# Markdown orchestration dispatcher

The MAIN agent is always the orchestrator, prompt-loop owner, store coordinator, and final decision maker. Subagents never talk to the user. This file is the only automatically loaded skill resource; linked references/templates remain explicitly on-demand.

## Gate

Engage for non-trivial work that has multiple files or steps, needs decomposition or durable tracking, resumes a tracked epic, or is explicitly requested. Handle trivial one-offs inline. Honor explicit `track this` and `skip tracking` overrides.

Before Gate/Intake, check whether the outcome or approach itself is still undecided — not just scope/AC details, which Intake's grilling covers. A request that names a goal without saying how to reach it, or where the data source, output shape, or approach is genuinely open, needs the `brainstorm` skill first: it turns the idea into an approved outcome and approach, which then feeds Intake's pinned spec. Don't engage tracking on an unbrainstormed idea just because the user mentioned orchestration or speed — orchestrate executes an already-decided plan.

Tracking uses `<main-repo-root>/.orchestration/`. It requires no external tracker, account, or authentication. If the filesystem is read-only and the store cannot be created, tell the user and use in-session todos; do not pretend persistence exists.

## Mandatory progressive loading

When the native skill tool loads this skill, capture the absolute **Base directory** reported with the loaded skill and define it as `skillRoot`. Every `read` call for a bundled resource MUST use an absolute `${skillRoot}/...` path; never resolve these resources from cwd, the target repository, or a worktree. References/templates do **not** auto-load.

If no Base directory is available, search the configured OpenCode skill paths **once** for `orchestrate/SKILL.md`, resolve its absolute parent directory as `skillRoot`, and verify that the required resources below exist. If the loaded SKILL cannot be uniquely resolved, STOP with a clear resource-resolution error; never silently skip a protocol or guess a cwd-relative path.

1. **Before Gate, Intake, Explore, Refine, or Design:** `read` `${skillRoot}/references/intake-design.md` and `${skillRoot}/references/platform.md`.
2. **Before creating, reading, resuming, or writing the store:** `read` `${skillRoot}/references/store-protocol.md`; when creating files also `read` the required `${skillRoot}/templates/PROJECT.md`, `${skillRoot}/templates/EPIC.md`, and/or `${skillRoot}/templates/issue.md`.
3. **Before Decompose, Plan, Execute, Relay, or Converge:** `read` `${skillRoot}/references/execution.md` and `${skillRoot}/references/platform.md`.
4. **Before any agent or specialist dispatch in any phase:** `read` `${skillRoot}/references/routing.md`. This is mandatory even if another phase reference was already loaded. It is the single authority for predicates, inputs, blocking role, writer, names, and model policy.
5. **Before reporting any terminal outcome (done, partial, blocked, aborted):** `read` `${skillRoot}/references/close-out-brief.md`. It owns the shape of the final report to the user.
6. Re-read a reference when the phase is resumed after compaction, handoff, or a changed issue Description. Do not rely on stale recalled policy.

## Ordered state machine

Run phases in order. Persist the current state and every specialist predicate result as required by the references.

### 0. Gate

Decide tracked versus inline. Confirm repository root and repo-docs readiness. If resuming, go directly to the Resume rule below before new intake or decomposition. For new work, when the outcome or approach itself is still undecided (not just scope/AC gaps), run the `brainstorm` skill first and carry its approved outcome/approach into Intake.

### 1. Intake

Pin objective, scope, constraints, acceptance criteria, terminology, validation expectations, and genuine user decisions. A ticket-prescribed choice is decided, not a reason to ask again. The main agent alone prompts the user. Never decompose an incomplete spec.

### 2. Explore

Ground the task in repository evidence. Produce a context pack precise enough to scope chunks and precompute every conditional specialist input. Surface unresolved user decisions before proceeding. Repository evidence, not priors, owns file scope.

### 3. Refine

Resolve only qualifying delegated technical decisions. Present recommendations and obtain user approval where required. Persist approved architectural/domain decisions before decomposition.

### 4. Design

For qualifying UI work, establish and approve a concrete design direction before UI decomposition. Record accessibility scope and any visual-reference requirements. Non-UI work records this phase skipped.

### 5. Decompose

Create or refresh the epic and issue specs from templates. Every issue Description is the current executable spec and routing context. It must contain its exact context-pack slice, explicit empty results, validation, and handoff contract. Do not embed workflow templates in this dispatcher.

Set `complexity` on every issue. It is the dispatch tier, not a label: `low` runs `md-worker-free`, `medium` `md-worker-terra`, `high` `md-worker-luna`, `max` `md-worker-sol`. Rate the work, not the topic. A chunk is `low` when the Description leaves no judgement to the worker, which is most mechanical chunks: renames, moves, config edits, applying an already-stated pattern to more call sites, docs edits. Rate up one tier for security/auth, data migrations, concurrency, money, or a public interface. Full table in `${skillRoot}/references/platform.md`.

### 6. Plan

When the routing predicate applies, conceptually dry-run chunks and derive authoritative dependency waves. Otherwise record the skip and use a safe trivial ordering. No worker starts before its dependencies and wave are authoritative.

### 7. Execute

For each ready chunk, evaluate pre-worker routing, update the Description with accepted preflight findings, then dispatch the selected worker. The worker owns chunk lifecycle, status transitions at non-concurrent points, build, bounded specialist review/retry, and final handoff. Dispatch only independent scopes concurrently.

### 8. Relay and record

Apply failed store-write relays, integrate only through user-approved mechanics, refresh `PROJECT.md`, and update stale pending specs. At retry cap or genuine ambiguity, persist the blocker and return to the user loop rather than grinding or guessing.

### 9. Converge

After all issues are Done, evaluate integrated predicates and run every applicable blocking gate over actual integrated state. Record each dispatched or skipped route. A failed blocking gate reopens work or creates a remediation chunk. Only a fully passing integrated result may enter close-out.

## Transition checkpoints

At every phase boundary, the orchestrator MUST make the transition explicit in the store or, before store creation, in its active task state. Record: phase completed, evidence produced, unresolved questions, next phase, and references that must be loaded next. Do not advance merely because an agent returned; validate its output shape, apply relays, and ensure blocking questions are resolved.

The following transitions are prohibited:

- Gate → Intake on new work while the outcome or approach itself is still undecided and `brainstorm` has not run and been approved.
- Intake → Explore while genuine user decisions remain hidden in assumptions.
- Explore → Refine/Design/Decompose without grounded file scopes and complete explicit conditional-input slices.
- Refine → Decompose before required user approval and ADR/domain recording.
- Design → Decompose before the concrete design and accessibility decision are recorded.
- Decompose/Plan → Execute before issue Descriptions and dependency waves are authoritative.
- Execute → next wave before prior dependencies are visible in the target workspace and PROJECT progress is current.
- Execute → Converge while any issue is not Done or any relay is unresolved.
- Converge → close-out while any blocking gate failed or any applicable route is unrecorded.
- Any terminal outcome → the satisfaction check without a rendered close-out brief.

When evidence invalidates an earlier phase, move back to the earliest affected phase, update the authoritative Description/EPIC state, and rerun downstream predicates. Never patch only a comment while leaving the executable spec stale.

## Resume rule

The store is authoritative. On resume, `read` `${skillRoot}/references/store-protocol.md`, `${skillRoot}/references/execution.md`, `${skillRoot}/references/routing.md`, and `${skillRoot}/references/platform.md`, then read store `PROJECT.md`, `EPIC.md`, and every open issue. Reconstruct state from issue frontmatter, not prose summaries. Append the current session ID if absent. Preserve existing authoritative waves; re-plan only when a Description or landed dependency materially changed. Re-scout only missing or stale context slices. Continue at the earliest incomplete phase; never recreate a parallel epic for the same work.

## Hard invariants

- The main agent owns user interaction, phase transitions, issue creation/spec edits, integrated convergence, close-out, and the close-out brief. No subagent writes the brief; only the orchestrator has seen the whole epic.
- Routing predicates live only in `${skillRoot}/references/routing.md`; do not recreate or broaden them elsewhere.
- Store schema, status ownership, append-only concurrency, relays, resume writes, and close-out writes live only in `${skillRoot}/references/store-protocol.md`.
- Common phase mechanics live in `${skillRoot}/references/intake-design.md` and `${skillRoot}/references/execution.md`; platform names/models/isolation/install/landing mechanics live only in `${skillRoot}/references/platform.md`.
- Every specialist decision is recorded as `dispatched` or `skipped: <reason>`. Empty precomputed input is inapplicable, never a fabricated pass.
- Specialists receive required precomputed slices verbatim. A specialist never discovers another role's inputs.
- Workers and the orchestrator change frontmatter status only at defined non-concurrent points. Reviewers/checkers append verdicts only and never move status.
- Comments are append-only. Attempt failed writes, relay them upward, and never silently drop store updates.
- Issue Description is the current spec. Accepted decisions, preflight findings, corrections, and changed interfaces must be folded into it before dispatch.
- Fix root causes, verify actual state, and prefer existing repository/native/framework/library mechanisms without weakening security, validation, accessibility, or required behavior.
- Never commit, create a branch, merge, push, or open a PR without explicit user approval. Approval for implementation is not landing approval.
- The `.orchestration/` store is never committed and the root `.gitignore` is never modified for it.

## Failure and close-out

At a worker retry cap, mark the issue blocked and ask the user with concrete options. On deferred work, record `partial`; on infeasible/aborted work, cancel open issues and explain why. Never mark an epic complete while a blocking gate fails, a relay is unapplied, or an issue remains open.

Every terminal outcome — done, partial, blocked, or aborted — is reported to the user as a **close-out brief** per `${skillRoot}/references/close-out-brief.md`: what changed, a plain-text diagram of the change itself, why, what it solves, what was verified with actual observed results, and what is still open. Render it before the landing question and append the same text to EPIC `## Completion`. A brief that replays the chunk list, diagrams the agents, or claims an unobserved pass is a defect.

For successful close-out, first `read` `${skillRoot}/references/store-protocol.md` and `${skillRoot}/references/platform.md`. Ask how the user wants the work landed; execute only the approved option. Refresh `PROJECT.md`'s single `Progress / Resume here` section with done/remaining issues and the actual landing location or `left uncommitted`. Re-read it to verify freshness, record epic completion, preserve `PROJECT.md`, and run the mandatory satisfaction check.
