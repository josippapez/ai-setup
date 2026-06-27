---
name: linear-orchestration
description: Use when a non-trivial, multi-step task should be tracked in Linear and executed by subagents. The main agent acts as orchestrator — it grills the task to a clear spec, sets up a per-repo Linear **project** (long-lived) with the epic as a **milestone** and its chunks as **issues**, then dispatches self-managing linear-worker subagents that build their chunk, run their own code-standards + review loop, and post their own Linear updates (relaying to the orchestrator only if a write is denied). The orchestrator drives convergence and statuses until done, partial, or abandoned.
---

# Linear orchestration

The MAIN agent is the orchestrator and prompt-loop owner. Plugin overview & one-time setup: `../../README.md`.

## When to engage

- Engage for non-trivial, multi-step tasks (multiple files/steps, or one that needs decomposition).
- Skip trivial one-offs — handle them inline.
- Honor explicit overrides ("track in Linear" / "skip Linear").
- This plugin **bundles the Linear MCP** (`https://mcp.linear.app/mcp`, server name `linear`) via its `.mcp.json`. If unauthenticated, ask the user to authenticate (or fall back to in-session todos and warn). (If the official `linear@claude-plugins-official` plugin is also installed, both load — disable one to avoid duplicate tools.)

## Hierarchy

One consistent shape per repo (fully MCP-automatable, zero manual setup):

- **Project** = one per repo/product — **long-lived; it never completes** (a repo keeps taking on work over time). Its **description** is a product overview.
- **Milestone** = an **epic / story / ticket** — a cohesive unit of work (usually a sprint or two). Its **description** holds that unit's goal + acceptance criteria. This *is* the epic.
- **Issue** = a chunk under a milestone; label `agent-task`.
- **Never create a parent "epic" issue** — the milestone is the epic.

> Note: Linear's own model treats a *Project* as a finite deliverable, *Milestones* as phases, *Initiatives* as long-lived products, and *Cycles* as sprints. We deliberately use the simpler shape (Project = the repo, Milestone = the epic) because the bundled MCP **cannot create Initiatives or Cycles** — making this the only fully-autonomous, zero-setup shape. (The Initiative=product / Project=epic / Cycle=sprint model would require a Linear personal API key + GraphQL; intentionally not used, to avoid managing a secret.)

## Project & team scoping (team-agnostic)

- Derive the project name from the repo — basename of `git rev-parse --show-toplevel` (e.g. `ai-setup`); fall back to the cwd basename.
- **Find the project workspace-wide:** `list_projects` (query = name) — do NOT filter by team. If found, resolve `TEAM` from `project.teams[0]`. The per-repo project is **long-lived** — never mark it completed.
- **If absent, create it** (team resolution below; `save_project` name + `addTeams: [TEAM]`).
- **Team resolution (never hardcode a team):** `list_teams` → **one** → use it; **`Ai agents`** among several → prefer it; **several** ambiguous → ask the user; **zero** → MCP can't create a team (no `teamCreate`; UI only) → ask the user to create one in Linear and wait, do NOT fall back to todos. Use the resolved `TEAM` for every team-scoped call (`list_issue_statuses`, `create_issue_label`, issue team, milestone).

## Addressing & concurrency (multi-project safe)

- **Everything is addressed by explicit ID, passed top-down.** The orchestrator resolves `{projectId, teamId, milestoneId, issueId}` and passes the exact IDs into each subagent prompt. **No subagent infers "the current project" from cwd/git** — there is no global "active project". This is what keeps several repos/epics safe in parallel.
- Set each issue's `project`, `milestone`, and `team` explicitly; never rely on a default.
- Code chunks that mutate files run in **per-worker git worktrees** (`isolation: worktree`) so concurrent workers across repos don't clobber each other.
- Overlapping file scopes in the SAME repo run sequentially; disjoint scopes — or different repos — run in parallel.

## Phases

0. **Gate** — engage vs inline.
1. **Intake (grill)** — before decomposing, **gap-check the task**: scan for missing/ambiguous elements (unclear scope, undefined acceptance criteria, ambiguous terms, unstated constraints, competing interpretations). If any exist, **grill the user to resolve them before creating any issues**; a fully-specified task needs only a quick scope confirmation. **Never decompose on an incomplete spec.** For grilling: **domain-heavy / schema-bearing** → `/grill-with-docs`; **simpler** → `/grilling`; if a skill is unavailable, fall back to a question-tool interview (graceful — never block on a missing skill). Orchestrator ↔ user only. **Design-input gate:** UI/visual/layout/design task with no design supplied (Figma, mockup, screenshot, wireframe, written spec, reference UI) → ask for one OR propose a direction before decomposing; leverage repo design tooling when present (graceful).
2. **Decompose** — first, **resume check**: find the per-repo Project, then the open **Milestone** for this epic; if it exists, read its **status update** ("Progress / Resume here") + `list_issues` (project, label `agent-task`) and rebuild from open issue statuses (authoritative) — continue it. Otherwise: ensure the per-repo Project exists; create ONE **Milestone for this epic/ticket** (`save_milestone`, description = goal + acceptance criteria); file one **issue per chunk** under it. Each issue MUST be self-contained: objective, exact scope/files, constraints, acceptance criteria, validation commands, handoff format, **complexity signal** (low/medium/high). Order by dependency; mark disjoint-scope chunks parallelizable. (First `list_issue_statuses` for `TEAM`; adapt names — see Status map.) Capture the domain model before any schema chunk (`/domain-modeling`, graceful skip). **Docs-upkeep:** if the repo has a docs convention (`docs/**`, a docs-sync rule, a CLAUDE.md docs policy), behavior/workflow/config-changing chunks MUST include "update owning docs" as acceptance criteria or a dedicated docs-sync chunk. **Code-quality gate:** if the repo exposes quality tooling/standards, each code chunk's validation MUST include the relevant gates — enforced at review time by the **code-standards-checker** the worker spawns (planning side here; execution side there).
3. **Execute (self-managing workers)** — dispatch one `linear-worker` per ready chunk (**model from the complexity signal** via the Agent `model` override — haiku/sonnet/opus), **inline + explicit `{projectId, teamId, milestoneId, issueId}` + complexity**, then step back. Each worker owns its chunk like a dev opening a PR: sets its issue **In Progress** → does the work → posts its own **findings** (+ `diff`) via MCP → **requests review** by spawning a **code-standards-checker** + a **linear-reviewer** (using the **namespaced** `subagent_type` `linear-orchestration:code-standards-checker` / `linear-orchestration:linear-reviewer`; reviewer model by complexity) → on fail, fixes + re-requests (≤2 rounds); on pass the reviewer sets **Done** → returns final status + any **relay** items. Parallelize only disjoint scopes.
4. **Relay & record** — the orchestrator's per-chunk duties: (a) **post any `relay` items** a subagent couldn't write itself; (b) at a worker's internal-retry cap without a pass, apply the `blocked` label + surface; (c) refresh the single **"Progress / Resume here" status update** on the project (`save_status_update`), listing done vs remaining issues (by id + milestone) + next action.
5. **Converge** — when the epic's issues are all Done, dispatch a final `linear-reviewer` against the **milestone's** acceptance criteria (integration coherence, not just per-chunk). Pass → the epic **Milestone** is complete (100%); **do NOT mark the per-repo Project completed — it's long-lived**; post a final status update + satisfaction check. Fail → status update with gaps; re-open issue(s) / add a chunk. Blocked/deferred → `partial` label + status update. Abort/infeasible → cancel the milestone's open issues + note.

## Linear I/O (subagents write their own — attempt-then-relay)

- **Subagents post their OWN Linear updates** via the MCP (worker: findings + status; checker/reviewer: their comments; reviewer moves status). A permission allow-rule (`mcp__plugin_linear-orchestration_linear`) in `settings.json` pre-authorizes these.
- **Attempt-then-relay:** if a subagent's write is denied (auto-mode classifier) or errors, it MUST NOT fail — it records `{issueId, action, body/status}` in a `relay` array returned to its parent, which re-attempts and bubbles still-failing items up. The **orchestrator** is the guaranteed writer of last resort.
- Reads are always allowed. The orchestrator owns project/milestone/issue **creation** and the status update.

## Status map

Todo → In Progress (worker start) → In Review (worker requests review) → Done (reviewer pass) / In Progress (fail → loop). `blocked` label at the retry cap; abandoned/infeasible → Canceled. **Epic completion = its Milestone reaching 100%** (the per-repo Project stays open). Full vocabulary: Todo, In Progress, In Review, Done, Canceled.

**Adapt to the team first:** before creating issues, `list_issue_statuses` for `TEAM` and map to its actual states; if one is missing (e.g. **In Review**), use the nearest (review still works with the chunk left In Progress). Same for labels: verify `agent-task`/`blocked`/`partial` exist for `TEAM`; `create_issue_label` first if not (Linear silently ignores unknown labels/states).

## Invariants

- Workers get fully-specified chunks addressed by **explicit IDs** + complexity; they self-manage build + standards-check + review.
- **Subagents write their own Linear updates; relay up only on a write error** — never silently drop one.
- **No parent "epic" issue** — the epic is a **Milestone**. The per-repo **Project** is the long-lived container and is **never marked completed**.
- Linear is the source of truth; on resume read the project's status update, then re-read open issues (statuses authoritative).
- Nests inside the existing prompt loop; follows `agent-orchestration` delegation rules. Companion skills (`/grilling`, `/domain-modeling`, `/grill-with-docs`) are graceful, not required.

## Defaults

- Team: resolved **per project** (team-agnostic; `Ai agents` only a preferred fallback). Project: per-repo, **long-lived**. Epic = **Milestone**. Chunks = **Issues** (label `agent-task`). Labels: `agent-task`, `blocked`, `partial`.
- Models: **per task by complexity** via the Agent `model` override (frontmatter `model` is a fallback) — worker haiku/sonnet/opus from the complexity signal; reviewer + checker likewise. Worker internal review-retry cap: 2.
