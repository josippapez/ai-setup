---
name: linear-orchestration
description: Use when a non-trivial, multi-step task should be tracked in Linear and executed by subagents. The main agent acts as orchestrator — it grills the task to a clear spec, decomposes it into a Linear parent issue plus sub-issues, dispatches linear-worker subagents per chunk, has a linear-reviewer subagent check each, and drives statuses until the task is done, partial, or abandoned. Subagents are read-only on Linear; the orchestrator performs all Linear writes.
---

# Linear orchestration

The MAIN agent is the orchestrator and prompt-loop owner. Plugin overview & one-time setup: `../../README.md`.

## When to engage

- Engage for non-trivial, multi-step tasks (multiple files/steps, or one that needs decomposition).
- Skip trivial one-offs — handle them inline.
- Honor explicit overrides ("track in Linear" / "skip Linear").
- This plugin **bundles the Linear MCP** (`https://mcp.linear.app/mcp`, server name `linear`) via its `.mcp.json`, so it's available on install. If the Linear MCP is unauthenticated, ask the user to authenticate (or fall back to in-session todos and warn that tracking won't persist). (If the official `linear@claude-plugins-official` plugin is also installed, both Linear servers load — disable one to avoid duplicate tools.)

## Project scoping

File issues under a **per-repo Linear project** (not loose in the team):
- Derive the project name from the current repo — the basename of `git rev-parse --show-toplevel` (e.g. `ai-setup`); fall back to the cwd basename if not a git repo.
- Find-or-create: `list_projects` (team `Ai agents`, query = name); if absent, `save_project` (name, `addTeams: ["Ai agents"]`).
- Create the parent issue and every sub-issue with `project` set to that project. One project per repo = a board per codebase.

## Phases

0. **Gate** — decide engage vs inline (above).
1. **Intake (grill)** — interview the user to a clear written spec before decomposing. For a **domain-heavy / schema-bearing** task, invoke `/grill-with-docs` (combines `/grilling` + `/domain-modeling`, capturing the ubiquitous language + ADRs as you go). For a **simpler** spec, `/grilling` alone is enough. These sharpen the spec but are **not hard dependencies** — if a skill is unavailable, fall back to a built-in question-tool scope interview and continue; never block intake on a missing skill. Orchestrator ↔ user only.
2. **Decompose** — first, call `list_issues` (project = the per-repo project, label `agent-task`) and check for an existing OPEN (not Done/Canceled) issue with no parent that matches the current task; if found, RESUME it by re-reading its open sub-issues to rebuild state instead of creating a new parent. Otherwise, create a Linear **parent issue** (body = spec summary + acceptance criteria), then one **sub-issue per chunk**. Each sub-issue MUST be self-contained: objective, exact scope/files, constraints, acceptance criteria, validation commands, handoff format. Order by dependency; mark chunks with disjoint file scopes as parallelizable. Sub-issues start in **Todo**. Label auto-created issues `agent-task`. (First call `list_issue_statuses` for the team and adapt the status names to what it actually has — see Status map.) Before decomposing any **schema/data-model** chunk, ensure the domain model is captured — if intake didn't already (e.g. `/grilling` alone), invoke `/domain-modeling` first (skip gracefully if the skill is absent).
3. **Execute** — per chunk: set the sub-issue **In Progress**, dispatch a `linear-worker` (model sonnet, or haiku for trivial) with the chunk **inline** + the sub-issue id. The worker returns a result including `findings` and `diff`; **you post `findings` as a comment**, then post the worker's `diff` as a second comment (fenced ` ```diff ` block) for traceability, and set the sub-issue **In Review**. Dispatch workers in parallel only when their file scopes are disjoint; if two chunks' scopes overlap, run them sequentially (the shared working tree has no isolation between workers).
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

- Workers get fully-specified chunks; never push ambiguity to a cheap worker.
- Linear is the source of truth; on resume, re-read open sub-issues to rebuild state.
- Nests inside the existing prompt loop; follows the `agent-orchestration` delegation rules.
- **Companion skills are graceful, not required:** `/grilling` + `/domain-modeling` (or the combined `/grill-with-docs`) enrich intake and schema work — never block orchestration on a missing or unavailable skill; fall back to question-tool intake / inline domain notes and continue.

## Defaults

- Team: `Ai agents`. Project: per-repo (see Project scoping). Labels: `agent-task` (all auto-created), `blocked`, `partial`.
- Models: worker sonnet (haiku trivial); reviewer sonnet (opus high-risk). Retry cap 2.
