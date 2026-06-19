---
name: linear-orchestration
description: Use when a non-trivial, multi-step task should be tracked in Linear and executed by subagents. The main agent acts as orchestrator — it grills the task to a clear spec, decomposes it into a Linear parent issue plus sub-issues, dispatches linear-worker subagents per chunk, has a linear-reviewer subagent check each, and drives statuses until the task is done, partial, or abandoned. Subagents are read-only on Linear; the orchestrator performs all Linear writes.
---

# Linear orchestration

The MAIN agent is the orchestrator and prompt-loop owner. Full design: `docs/superpowers/specs/2026-06-19-linear-orchestration-design.md`.

## When to engage

- Engage for non-trivial, multi-step tasks (multiple files/steps, or one that needs decomposition).
- Skip trivial one-offs — handle them inline.
- Honor explicit overrides ("track in Linear" / "skip Linear").
- If the Linear MCP is unauthenticated, ask the user to authenticate (or fall back to in-session todos and warn that tracking won't persist).

## Phases

0. **Gate** — decide engage vs inline (above).
1. **Intake (grill)** — use the brainstorming/grilling flow with the user to reach a clear written spec. Orchestrator ↔ user only.
2. **Decompose** — create a Linear **parent issue** (body = spec summary + acceptance criteria), then one **sub-issue per chunk**. Each sub-issue MUST be self-contained: objective, exact scope/files, constraints, acceptance criteria, RTK-prefixed validation commands, handoff format. Order by dependency; mark independents parallelizable. Sub-issues start in **Todo**. Label auto-created issues `agent-task`. (First call `list_issue_statuses` for the team and adapt the status names to what it actually has — see Status map.)
3. **Execute** — per chunk: set the sub-issue **In Progress**, dispatch a `linear-worker` (model sonnet, or haiku for trivial) with the chunk **inline** + the sub-issue id. The worker returns a result including `findings`; **you post `findings` as a comment** and set the sub-issue **In Review**. Independent chunks may run as parallel workers.
4. **Review** — dispatch a `linear-reviewer` with the acceptance criteria + the worker's diff/result. It returns `verdict`, `review_comment`, `target_status`. **You post `review_comment`** and set the status: pass → **Done**; fail → **In Progress** (post the fix-list), retry up to 2; at the cap apply the `blocked` label and surface to the user.
5. **Converge** — all Done → parent **Done** + summary + satisfaction check. Some blocked/deferred → parent + `partial` label + a comment listing done vs remaining. User aborts / infeasible → parent **Canceled**.

## Linear I/O (relayed model — subagents are read-only)

- **Orchestrator** performs ALL Linear writes: create issues, post comments, move statuses.
- **Workers** return `findings` (you post it). **Reviewer** returns `review_comment` + `target_status` (you post and move).
- Subagents MAY read Linear; they MUST NOT write. (Verified: subagent writes are blocked by the auto-mode external-write classifier.)

## Status map

Todo → In Progress (orchestrator, at dispatch) → In Review (orchestrator, when worker returns) → Done (reviewer pass) / In Progress (reviewer fail → retry). `blocked` label at the retry cap; an abandoned/infeasible chunk → Canceled. Parent → Done / Canceled / `partial`. Full state vocabulary: Todo, In Progress, In Review, Done, Canceled.

**Adapt to the team first:** before creating issues, call `list_issue_statuses` for the team and map these names to the states it actually has. If a state is missing (e.g. **In Review**, or **Todo**), use the nearest one — review still runs with the chunk left **In Progress**, and queued chunks use **Backlog**/**Todo** (whichever exists). Setting a state the team doesn't have is silently ignored by Linear, so never assume one exists.

## Invariants

- RTK for every shell command (orchestrator and all subagents).
- Workers get fully-specified chunks; never push ambiguity to a cheap worker.
- Linear is the source of truth; on resume, re-read open sub-issues to rebuild state.
- Nests inside the existing prompt loop; follows the `agent-orchestration` delegation rules.

## Defaults

- Team: `Ai agents`. Labels: `agent-task` (all auto-created), `blocked`, `partial`.
- Models: worker sonnet (haiku trivial); reviewer sonnet (opus high-risk). Retry cap 2.
