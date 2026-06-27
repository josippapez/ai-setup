---
name: linear-orchestration
description: Use when a non-trivial, multi-step task should be tracked in Linear and executed by subagents. The main agent acts as orchestrator — it grills the task to a clear spec, sets up a per-repo Linear **project** (the epic) with **milestones** (phases) and **issues** (chunks), then dispatches self-managing linear-worker subagents that each build their chunk, run their own code-standards + review loop, and post their own Linear updates (relaying to the orchestrator only if a write is denied). The orchestrator drives convergence and statuses until done, partial, or abandoned.
---

# Linear orchestration

The MAIN agent is the orchestrator and prompt-loop owner. Plugin overview & one-time setup: `../../README.md`.

## When to engage

- Engage for non-trivial, multi-step tasks (multiple files/steps, or one that needs decomposition).
- Skip trivial one-offs — handle them inline.
- Honor explicit overrides ("track in Linear" / "skip Linear").
- This plugin **bundles the Linear MCP** (`https://mcp.linear.app/mcp`, server name `linear`) via its `.mcp.json`. If the Linear MCP is unauthenticated, ask the user to authenticate (or fall back to in-session todos and warn that tracking won't persist). (If the official `linear@claude-plugins-official` plugin is also installed, both load — disable one to avoid duplicate tools.)

## Hierarchy

Model work with Linear's native hierarchy — **the Project IS the epic; do NOT also create a parent "epic" issue.**

- **Initiative** (optional grouping): a category spanning projects (e.g. `Personal Products`, `Work`, `Infra`). Attach when the user groups work this way — never required.
- **Project** = one per repo/app. Its **description** holds the spec summary + acceptance criteria.
- **Milestone** = a phase (e.g. `Spikes`, `M1`, `M2`…). Group issues by milestone instead of encoding the phase in the title.
- **Issue** = a chunk. Belongs to a milestone (when phased), carries the `agent-task` label. No parent issue.

## Project & team scoping (team-agnostic)

**No specific team is assumed to exist** — resolve the team dynamically, then address everything by ID.

- Derive the project name from the current repo — basename of `git rev-parse --show-toplevel` (e.g. `ai-setup`); fall back to the cwd basename if not a git repo.
- **Find the project workspace-wide (across ALL teams):** `list_projects` (query = name) — do NOT filter by team. If it exists, **resolve `TEAM` from the project itself** (`project.teams[0]`) and skip team selection.
- **If the project does not exist, resolve `TEAM` for the new project** (never hardcode a team name):
  1. `list_teams`. **One** → use it. **`Ai agents` present** among several → prefer it (legacy default). **Several with no clear default** → ask the user which team.
  2. **Zero teams** → the bundled MCP **cannot create a team** (no `teamCreate`; creation needs a Linear API key via `@linear/sdk`/GraphQL; no official CLI). **Ask the user to create a team in Linear (Settings → Teams) and wait** — do NOT fall back to in-session todos, do NOT proceed until one exists. Re-check `list_teams` after they confirm.
  3. Then `save_project` (name, `addTeams: [TEAM]`, optional `addInitiatives`).
- **Use the resolved `TEAM` for every team-scoped call** (`list_issue_statuses`, `create_issue_label`, issue team, milestone). A project may live under any team (e.g. `Side projects`).

## Addressing & concurrency (multi-project safe)

The orchestrator may run **several projects at once**. The invariant that prevents collisions:

- **Everything is addressed by explicit ID, passed top-down.** The orchestrator resolves `{projectId, teamId, milestoneId, issueId}` and passes the exact IDs into each subagent prompt. **No subagent infers "the current project" from cwd/git/ambient state** — there is no global "active project".
- Set each issue's `project`, `milestone`, and `team` explicitly on create/update; never rely on a default.
- Code chunks that mutate files run in **per-worker git worktrees** (`isolation: worktree`) so concurrent workers across repos don't clobber each other.
- Two chunks with overlapping file scope in the SAME repo run sequentially; disjoint scopes — or different repos — run in parallel.
- Because every write targets an explicit ID, parallel workers writing their own updates never address the wrong issue.

## Phases

0. **Gate** — engage vs inline.
1. **Intake (grill)** — interview the user to a clear written spec before decomposing. **Domain-heavy / schema-bearing** → `/grill-with-docs` (`/grilling` + `/domain-modeling`, capturing ubiquitous language + ADRs). **Simpler** → `/grilling` alone. Not hard dependencies — if a skill is unavailable, fall back to a question-tool scope interview; never block intake on a missing skill. Orchestrator ↔ user only. **Design-input gate:** if the task involves UI / visual / layout / design work and no design is supplied (Figma link, mockup, screenshot, wireframe, written spec, or reference UI), you MUST ask for one OR propose a direction before decomposing. Leverage repo design tooling when present (graceful).
2. **Decompose** — first, **resume check**: `list_projects` (name) workspace-wide; if the project exists, read its latest **project status update** ("Progress / Resume here") for the fast picture, then `list_issues` (project, label `agent-task`) and rebuild state from open issue statuses (issue state authoritative) — continue that board. Otherwise set it up: ensure the **project** exists (description = spec + acceptance criteria), create a **milestone per phase** (`save_milestone`), then one **issue per chunk** with `project`, `milestone`, `team` set explicitly, label `agent-task`, starting in **Todo**. Each issue MUST be self-contained: objective, exact scope/files, constraints, acceptance criteria, validation commands, handoff format, **and a complexity signal** (low / medium / high — informs the worker's reviewer-tier choice). Order by dependency; mark disjoint-scope chunks parallelizable. (First `list_issue_statuses` for `TEAM`; adapt names — see Status map.) Capture the domain model before any schema chunk (`/domain-modeling`, graceful skip). **Docs-upkeep:** if the repo has a docs convention (`docs/**`, a docs-sync rule, or a CLAUDE.md docs policy), any chunk that changes behavior/workflow/config MUST include "update owning docs" as acceptance criteria or get a dedicated docs-sync chunk. **Code-quality gate:** if the repo exposes quality tooling/standards (lint/format/typecheck/test scripts, a coding-standards rule, CI config, post-edit-diagnostics), each code chunk's validation MUST include the relevant gates — and the **code-standards-checker** the worker spawns in Phase 3 enforces those same gates + coding-standards rules at review time (the planning side here; the execution side there).
3. **Execute (self-managing workers)** — dispatch one `linear-worker` per ready chunk (**model chosen from the complexity signal via the Agent `model` override** — haiku trivial / sonnet normal / opus high), **inline + explicit `{projectId, teamId, milestoneId, issueId}` + the complexity signal**, then step back. Each worker owns its chunk end-to-end, like a dev opening a PR:
   - sets its issue **In Progress**, does the work (in scope only), runs validation;
   - posts its own **findings comment** (+ `diff`) on the issue via the Linear MCP;
   - **requests review** by spawning a **code-standards-checker** (sonnet) and a **linear-reviewer**, choosing the reviewer's tier by complexity — **opus** for high-risk/large/security/migration/concurrency chunks, **sonnet** otherwise;
   - on a fail verdict, addresses the fix-list and re-requests review, looping up to **2** internal rounds; on pass, the reviewer sets the issue **Done**;
   - returns a compact result up: final status (`done | blocked | partial`) + any **relay** items it (or its children) couldn't post directly.
   Dispatch workers in parallel only for disjoint file scopes (or different repos); overlapping scopes in one repo run sequentially.
4. **Relay & record** — the orchestrator's only per-chunk duties: (a) **post any `relay` items** a subagent couldn't write itself (see Linear I/O) — the orchestrator is the authorized writer of last resort; (b) if a worker hit its internal review cap without a pass, apply the `blocked` label and surface to the user; (c) after each chunk settles, refresh the single **project status update** ("Progress / Resume here": done vs remaining issues by id + milestone, next action — create once via `save_status_update`, then update in place by id).
5. **Converge** — when all issues are Done, dispatch a final `linear-reviewer` with the assembled result against the **project's** acceptance criteria (integration coherence, not just per-chunk pass). Pass → set the **project state** to completed + final status update + satisfaction check. Fail → status update listing gaps; re-open issue(s) / add a chunk; do NOT complete the project. Some blocked/deferred → `partial` label on open issues + status update. User aborts / infeasible → project **canceled**.

## Linear I/O (subagents write their own — attempt-then-relay)

- **Subagents post their OWN Linear updates** via the MCP: the worker posts its findings comment + sets its issue's status; the code-standards-checker and the reviewer post their own comments; the reviewer moves the status on its verdict. A permission allow-rule (`mcp__plugin_linear-orchestration_linear`) in `settings.json` pre-authorizes these.
- **Attempt-then-relay:** if a subagent's Linear write is denied (auto-mode external-write classifier) or errors, it MUST NOT fail the task. It captures the intended `{issueId, action, body/status}` in a `relay` array and returns it to its parent; the parent re-attempts, and bubbles still-failing items upward. The **orchestrator** (which carries the user's authorization) is the guaranteed writer of last resort and posts anything that reached it via `relay`.
- Reads are always allowed. The orchestrator still owns project/milestone/issue **creation** and the project status update.

## Status map

Todo → In Progress (worker, at start) → In Review (worker, when it requests review) → Done (reviewer pass) / In Progress (reviewer fail → worker loops). `blocked` label when a worker exhausts its internal retry cap; abandoned/infeasible → Canceled. Project → completed / canceled / `partial`. Full vocabulary: Todo, In Progress, In Review, Done, Canceled.

**Adapt to the team first:** before creating issues, call `list_issue_statuses` for `TEAM` and map these to the states it actually has. If one is missing (e.g. **In Review** or **Todo**), use the nearest — review still works with the chunk left **In Progress**; queued chunks use **Backlog**/**Todo**. Setting a nonexistent state is silently ignored, so never assume one exists. Same for labels: verify `agent-task`/`blocked`/`partial` exist for `TEAM`; create via `create_issue_label` first if not (Linear silently ignores an unknown label). These checks are the orchestrator's job at setup so workers can rely on the names.

## Invariants

- Workers get fully-specified chunks addressed by **explicit IDs** + a complexity signal; they self-manage build + standards-check + review.
- **Subagents write their own Linear updates; they relay up only on a write error** — they never silently drop an update.
- The **Project is the epic** — no parent issue; phases are **milestones**, chunks are **issues**.
- Linear is the source of truth; on resume, read the **project status update** for the fast path, then re-read open issues (issue statuses authoritative).
- Nests inside the existing prompt loop; follows `agent-orchestration` delegation rules.
- **Companion skills are graceful, not required** (`/grilling`, `/domain-modeling`, `/grill-with-docs`).

## Defaults

- Team: resolved **per project** (team-agnostic; `Ai agents` only a preferred fallback for a new project). Grouping: optional **Initiative**. Project: per-repo (= the epic). Phases: **Milestones**. Chunks: **Issues** (label `agent-task`). Labels: `agent-task`, `blocked`, `partial`.
- Models: **chosen per task by complexity, passed via the Agent `model` override** (frontmatter `model` is only a fallback default). The orchestrator picks the **worker's** model from the chunk's complexity signal — haiku (trivial) / sonnet (normal) / opus (high or risky). The worker likewise picks its **reviewer** and **code-standards-checker** model by complexity. Worker internal review-retry cap: 2.
