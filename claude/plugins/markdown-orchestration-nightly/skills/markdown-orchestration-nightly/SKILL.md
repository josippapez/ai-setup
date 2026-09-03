---
name: markdown-orchestration-nightly
description: 'Experimental nightly orchestration: build-only workers on the cheapest adequate model, review batched every two chunks, cheap fixer for fix-lists. Same git-ignored markdown store as the stable workflow. The main agent owns the user loop and the state machine.'
when_to_use: 'Only on explicit request: the user says "nightly", "orchestrate nightly", "use the nightly orchestration", or runs /orchestrate-nightly, or resumes an epic whose EPIC.md records `workflow: nightly`. Never engage on the generic "track this" / "orchestrate this" triggers; those belong to the stable markdown-orchestration skill.'
---

# Markdown orchestration dispatcher (nightly)

The MAIN agent is always the orchestrator, prompt-loop owner, store coordinator, and the only status writer. Subagents never talk to the user and never spawn agents. This file is the only automatically loaded skill resource; linked references/templates remain explicitly on-demand.

## What is different from stable

Measured on 23 past worker runs, a chunk's review fan-out (three to five reviewer subagents per chunk, each loading the spec and repo afresh) cost a quarter to a third of the chunk and sat on the critical path after every build, and opus workers cost six times a sonnet worker while taking two and a half times longer. Nightly changes four things and keeps everything else:

1. Workers only build (`md-builder`). They run the supplied quality commands and test suite themselves. No nested spawns.
2. Review is one `batch-reviewer` per two finished chunks (or per wave tail), running while the next builders run. It carries the correctness, standards, and implementation-quality checklists in one context load. Risk-tagged chunks are reviewed solo on opus.
3. Fix-lists go to a cheap `md-fixer`, not back to the original builder.
4. Build model is one tier lower: `high` means sonnet unless a `risk` tag is set; opus is for risk, not size. Decompose into fewer, larger chunks.

Goal to beat, per epic: less wall-clock than the stable workflow and no more tokens. Measure it with `bench/orchestration-cost.cjs` and report it in the close-out brief.

## Gate

Engage only on the explicit triggers in `when_to_use`. Tracking uses `<main-repo-root>/.orchestration/`, shared with the stable workflow. Record `workflow: nightly` in EPIC frontmatter so a resume picks the same workflow. If the filesystem is read-only and the store cannot be created, tell the user and use in-session todos.

The stable `markdown-orchestration` plugin must be installed: nightly uses its grilling, grill-with-docs, domain-modeling, and wcag-guidelines skills. The `repo-docs` plugin must also be installed for its MCP tools. `claude/install.sh` installs both automatically; if either is missing, tell the user to run it (or `claude plugin install repo-docs@ai-setup` / `markdown-orchestration@ai-setup`) before Explore. If `mcp__plugin_repo-docs_repo-docs__find_docs` is not callable, tell the user before Explore.

## Mandatory progressive loading

Immediately define the absolute skill root:

`skillRoot = "${CLAUDE_SKILL_DIR}"`

`${CLAUDE_SKILL_DIR}` is Claude Code's native absolute directory for the skill containing this `SKILL.md`. Every Read call for a bundled resource MUST use an absolute `${skillRoot}/...` path; never resolve these resources from cwd, the target repository, or a worktree. References/templates do **not** auto-load.

1. **Before Gate, Intake, Explore, Refine, or Design:** Read `${skillRoot}/references/intake-design.md` and `${skillRoot}/references/platform.md`.
2. **Before creating, reading, resuming, or writing the store:** Read `${skillRoot}/references/store-protocol.md`; when creating files also Read the required `${skillRoot}/templates/PROJECT.md`, `${skillRoot}/templates/EPIC.md`, and/or `${skillRoot}/templates/issue.md`.
3. **Before Decompose, Plan, Execute, Review, or Converge:** Read `${skillRoot}/references/execution.md` and `${skillRoot}/references/platform.md`.
4. **Before any agent or specialist dispatch in any phase:** Read `${skillRoot}/references/routing.md`. It is the single authority for predicates, inputs, batch formation, names, and model policy.
5. **Before reporting any terminal outcome:** Read `${skillRoot}/references/close-out-brief.md`.
6. Re-read a reference when a phase is resumed after compaction, handoff, or a changed issue Description.

## Ordered state machine

### 0. Gate

Decide tracked versus inline. Confirm repository root and repo-docs readiness. If resuming, go to the Resume rule.

### 1. Intake

Pin objective, scope, constraints, acceptance criteria, terminology, validation expectations, and genuine user decisions. The main agent alone prompts the user. Never decompose an incomplete spec.

### 2. Explore

Ground the task in repository evidence. Produce a context pack precise enough to scope chunks and precompute every conditional specialist input. Repository evidence, not priors, owns file scope.

### 3. Refine

Resolve only qualifying delegated technical decisions. Persist approved architectural/domain decisions before decomposition.

### 4. Design

For qualifying UI work, establish and approve a concrete design direction before UI decomposition. Non-UI work records this phase skipped.

### 5. Decompose

Create or refresh the epic and issue specs from templates. Target 2–4 chunks; merge chunks that write the same files; fold tiny chunks into neighbours. Set `complexity` and `risk` on every issue: together they are the dispatch model (`${skillRoot}/references/platform.md`). `low` is haiku and is the default for fully specified mechanical work. `high` without a risk tag is sonnet.

### 6. Plan

When the routing predicate applies, dry-run chunks with impl-planners and derive authoritative dependency waves. Otherwise record the skip and use a safe ordering. No builder starts before its wave is authoritative.

### 7. Execute

For each ready chunk: evaluate pre-build routing, fold accepted preflight findings into the Description, set `In Progress`, dispatch `md-builder`. On return, evaluate the test-specialist row, set `In Review`, and form a review batch when `${skillRoot}/references/routing.md` says one is due. Dispatch the `batch-reviewer` and keep dispatching ready builders; do not wait for review unless nothing else is ready.

### 8. Review, fix, and record

Join batch verdicts. Pass → `Done`. Fail → `md-fixer` with the exact fix-list, then back into the next batch. Two fix rounds per issue, then `blocked` and back to the user. Apply relays, refresh `PROJECT.md`, correct stale pending specs.

### 9. Converge

After all issues are Done, dispatch one integrated `batch-reviewer` over the whole epic (epic ACs, coherence, standards, full suite) plus the conditional convergence rows. A failed gate reopens work or creates a remediation chunk. Only a fully passing integrated result may enter close-out.

## Transition checkpoints

At every phase boundary, make the transition explicit in the store (or in task state before store creation): phase completed, evidence produced, unresolved questions, next phase, references to load next. Do not advance merely because an agent returned; validate its output shape, apply relays, resolve blocking questions.

Prohibited transitions:

- Intake → Explore while genuine user decisions remain hidden in assumptions.
- Explore → Decompose without grounded file scopes and complete conditional-input slices.
- Refine → Decompose before required user approval and ADR recording.
- Decompose/Plan → Execute before Descriptions, `complexity`, `risk`, and waves are authoritative.
- Execute → next wave before prior dependencies are visible in the target workspace.
- Execute → Converge while any issue is not Done or any relay is unresolved.
- Converge → close-out while any blocking gate failed or any applicable route is unrecorded.
- Any terminal outcome → the satisfaction check without a rendered close-out brief.

## Resume rule

The store is authoritative. On resume, Read `${skillRoot}/references/store-protocol.md`, `${skillRoot}/references/execution.md`, `${skillRoot}/references/routing.md`, and `${skillRoot}/references/platform.md`, then read store `PROJECT.md`, `EPIC.md`, and every open issue. Reconstruct state from issue frontmatter. Append the current session ID if absent. Preserve existing waves. An issue left `In Review` with no batch-reviewer verdict joins the next batch. Continue at the earliest incomplete phase; never recreate a parallel epic for the same work. If `EPIC.md` lacks `workflow: nightly`, stop and tell the user the epic belongs to the stable workflow.

## Hard invariants

- The main agent owns user interaction, phase transitions, issue creation/spec edits, every status change, batch formation, convergence, close-out, and the close-out brief.
- Routing predicates and batch formation live only in `${skillRoot}/references/routing.md`.
- Store schema, status ownership, append-only concurrency, relays, and resume writes live only in `${skillRoot}/references/store-protocol.md`.
- Phase mechanics live in `${skillRoot}/references/intake-design.md` and `${skillRoot}/references/execution.md`; names, models, isolation, and landing mechanics live only in `${skillRoot}/references/platform.md`.
- Every dispatch passes an explicit `model`. Frontmatter is sonnet everywhere, so an omitted override silently upgrades mechanical work.
- No subagent spawns a subagent. A builder that reports a review need is a defect in its prompt, not a reason to relay.
- Every specialist decision is recorded as `dispatched` or `skipped: <reason>`. Empty precomputed input is inapplicable, never a fabricated pass.
- Specialists read their precomputed slices from the issue or epic file they are pointed at. A dispatch prompt carries absolute paths, `complexity`/`risk`, batch or round facts, and only facts not yet in the store; it never restates the spec, the slices, or the agent definition's own process. Specialists never discover another role's inputs.
- Comments are append-only. Attempt failed writes, relay them upward, never drop store updates.
- Issue Description is the current spec; fold accepted decisions and corrections into it before dispatch.
- Never commit, branch, merge, push, or open a PR without explicit user approval.
- The `.orchestration/` store is never committed and the root `.gitignore` is never modified for it.

## Failure and close-out

At the fix cap, mark the issue blocked and ask the user with concrete options. On deferred work, record `partial`; on infeasible work, cancel open issues and explain why. Never mark an epic complete while a blocking gate fails, a relay is unapplied, or an issue remains open.

Every terminal outcome is reported as a **close-out brief** per `${skillRoot}/references/close-out-brief.md`: what changed, a plain-text diagram of the change, why, what it solves, what was verified with observed results, what is still open, and the measured cost and wall-clock from `bench/orchestration-cost.cjs` for this epic. Render it before the landing question and append it to EPIC `## Completion`.

For successful close-out, first Read `${skillRoot}/references/store-protocol.md` and `${skillRoot}/references/platform.md`. Ask how the user wants the work landed; execute only the approved option. Refresh `PROJECT.md`'s `Progress / Resume here` section, record epic completion, and run the satisfaction check.
