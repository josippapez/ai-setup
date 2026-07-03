---
name: linear-orchestration
description: Use when a non-trivial, multi-step task should be tracked in Linear and executed by subagents — multi-file or multi-step work that needs decomposition, an epic/ticket to execute end-to-end, or a previously tracked epic to resume. Also on explicit asks like "track this in Linear" or "orchestrate this". The main agent follows this skill as the orchestrator; the skill body is the authoritative workflow.
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

> Rationale for this shape vs Linear's own model: see the plugin `README.md` (*Why Project = repo, Milestone = epic*).

## Project & team scoping (team-agnostic)

- Derive the project name from the repo — basename of `git rev-parse --show-toplevel` (e.g. `ai-setup`); fall back to the cwd basename.
- **Find the project workspace-wide:** `list_projects` (query = name) — do NOT filter by team. If found, resolve `TEAM` from `project.teams[0]`. The per-repo project is **long-lived** — never mark it completed.
- **If absent, create it** (team resolution below; `save_project` name + `addTeams: [TEAM]`).
- **Team resolution (never hardcode a team):** `list_teams` → **one** → use it; **`Ai agents`** among several → prefer it; **several** ambiguous → ask the user; **zero** → MCP can't create a team (no `teamCreate`; UI only) → ask the user to create one in Linear and wait, do NOT fall back to todos. Use the resolved `TEAM` for every team-scoped call (`list_issue_statuses`, `create_issue_label`, issue team, milestone).

## Addressing & concurrency (multi-project safe)

- **Everything is addressed by explicit ID, passed top-down.** The orchestrator resolves `{projectId, teamId, milestoneId, issueId}` and passes the exact IDs into each subagent prompt. **No subagent infers "the current project" from cwd/git** — there is no global "active project". This is what keeps several repos/epics safe in parallel.
- Set each issue's `project`, `milestone`, and `team` explicitly; never rely on a default.
- Overlapping file scopes in the SAME repo run sequentially; disjoint scopes — or different repos — run in parallel.
- **Worktree isolation is only for *concurrent* writers.** Pass `isolation: worktree` to a worker **only** when two or more mutating workers run **in parallel** (disjoint scopes in the same repo, or different repos) and would otherwise clobber each other. Worktree isolation is expensive — don't pay for it on a chunk that runs alone or sequentially.
- **Sequential, solo, or dependent chunks run in place** (no worktree) on the epic's shared feature branch, so each builds naturally on the last. A fresh worktree forks from the *base* commit, so an isolated dependent chunk would NOT see its dependency's work, and a solo chunk's changes get stranded uncommitted inside a throwaway worktree.
- **Integration is the orchestrator's job.** Before dispatching a chunk that depends on a prior one, land the prior chunk's work onto the epic's feature branch (merge its worktree branch, or — for in-place chunks — it's already there). Never dispatch a dependent chunk against a base that lacks its dependency. Workers leave changes uncommitted / on their branch; the orchestrator owns branch creation and integration (and on the default branch, **branches first**). **Commit per chunk:** once a chunk's reviewer sets Done, the orchestrator commits its changes to the epic's feature branch (one commit per chunk, referencing the issue ID; for a worktree chunk, merge its branch) — so per-chunk diffs stay clean, a blocked chunk resets to the last commit instead of hunk surgery, and Converge's integrated diff is simply `git diff base...epic`.

## Phases

0. **Gate** — engage vs inline.
1. **Intake (grill)** — orchestrator ↔ user only. **Never decompose on an incomplete spec.**
   - **Gap-check the task** before decomposing: scan for missing/ambiguous elements (unclear scope, undefined acceptance criteria, ambiguous terms, unstated constraints, competing interpretations).
   - **A "gap" is something the ticket genuinely leaves undefined or ambiguous — NOT something its acceptance criteria already prescribe.** If the ACs already specify the approach (which layer/component owns a behavior, the expected outcome, the validation), treat it as *decided*: proceed on the ACs and do NOT prompt the user to re-choose it — that is noise, and it reads as asking them to decide what the ticket already decided. Prompt only for genuinely undefined gaps; when a gap sits next to an AC-specified part, ask ONLY about the undefined slice, not the whole area.
   - **Pre-grill scout:** before grilling, dispatch the bundled `repo-scout` agent (`subagent_type: linear-orchestration:repo-scout`, **quick** mode, haiku) over the task's apparent area, passing the code-answerable gaps as questions — grill the user ONLY with what the scout couldn't answer from the repo (its `open_questions` + genuine preference/scope decisions).
   - **Default to grilling for any non-trivial task** — invoke the grill skill via the **Skill tool** unless the spec is *provably* complete (scope, acceptance criteria, and all terms already pinned with no competing interpretation), in which case a quick scope confirmation suffices.
   - **Which skill:** domain-heavy / schema-bearing → invoke `linear-orchestration:grill-with-docs` (via the Skill tool); simpler → invoke `linear-orchestration:grilling`. Only if the Skill tool cannot load it, fall back to a question-tool interview (graceful — never block on a missing skill, but do NOT use "graceful" as a reason to skip grilling a task with real gaps).
   - **Design-input gate:** UI/visual/layout/design task with no design supplied (Figma, mockup, screenshot, wireframe, written spec, reference UI) → ask for one OR propose a direction before decomposing; leverage repo design tooling when present (graceful).
2. **Explore (deep scout)** — once the spec is pinned, dispatch the bundled `repo-scout` (`subagent_type: linear-orchestration:repo-scout`, **deep** mode, sonnet; parallel scouts only for genuinely disjoint multi-area epics) with the confirmed scope.
   - It returns the **context pack**: per-area file lists (chunk-scope precision), reuse candidates (existing patterns/utilities — the highest-value output), blast radius, cross-area `overlaps`, quality gates, docs conventions, and `open_questions`.
   - **Surface `open_questions` to the user before decomposing** — they are intake gaps the code couldn't answer.
   - The pack grounds the council and is the REQUIRED evidence base for decompose's file scopes — **never decompose from priors when a scout can look.**
   - Docs-only epics may downgrade to a quick-mode scout (haiku). Skip entirely when intake's quick scout already covered the confirmed scope end-to-end, or on a **resume** (the milestone already exists — its description carries the pack; jump to Decompose's resume check and re-scout only a remaining chunk whose spec lacks its slice).
3. **Refine (architecture council)** — *conditional; fires only when the user delegated a technical decision.* **Never decompose before a surfaced delegated decision is resolved.**
   - If intake surfaces open **high-impact technical decisions the user left to us** (architecture, structure, data model, security posture, tech/library choice), the orchestrator **auto-offers a council** rather than deciding unilaterally, and proceeds on the user's OK.
   - A council = **3–4 bundled `council-member` agents in parallel** (`subagent_type: linear-orchestration:council-member`), each given the decision question, the context-pack slice for the affected area, and ONE assigned lens; each returns a strict-JSON proposal (tradeoffs, risks, `path:line` evidence, rejected alternatives, confidence).
   - **Pick the lenses to match the decision type** — always **simplicity/YAGNI** + **repo-convention fit**, then per type: **security** (auth, data exposure, trust boundaries), **migration & operability** (data models, schema changes), **maintenance/licensing/bus-factor** (library choices), **performance/scale** (hot paths).
   - Councilors run on **sonnet**; **opus** for security-critical or high-blast-radius decisions (never haiku).
   - The orchestrator **synthesizes one recommendation** (grafting the best of the runners-up) and presents it with the key tradeoffs for **user approval**. **Default is lightweight** (parallel proposals → synthesis); **escalate to a scored judge-panel / adversarial cross-critique only for security-critical or high-blast-radius decisions.**
   - Record the approved approach in the **milestone description** (write it as an ADR by invoking `linear-orchestration:domain-modeling` via the Skill tool; if it can't load, inline the ADR text directly — don't skip recording the decision).
   - Skip entirely when the decision is trivial, fully constrained by the user, or **already prescribed by the ticket's acceptance criteria** (don't convene a council — or ask — over a choice the ACs already made).
4. **Decompose** — turn the pinned spec + context pack into the Linear epic (milestone + issues).
   - First, **resume check**: find the per-repo Project, then the open **Milestone** for this epic; if it exists, read its **status update** ("Progress / Resume here") + `list_issues` (project, label `agent-task`) and rebuild from open issue statuses (authoritative) — continue it.
   - Otherwise: ensure the per-repo Project exists; create ONE **Milestone for this epic/ticket** (`save_milestone`, description = goal + acceptance criteria + a compact **Context pack** section: per-area files, reuse candidates, gates — so resume and the council re-read it from Linear); file one **issue per chunk** under it. (First `list_issue_statuses` for `TEAM`; adapt names — see Status map.)
   - Each issue MUST be self-contained: objective, exact scope/files, constraints, acceptance criteria, validation commands, handoff format, **complexity signal** (low/medium/high), and its **context-pack slice** (the pack's files + reuse candidates + gates for THIS chunk's scope — so the worker starts warm instead of re-exploring). **File scopes come from the context pack, not priors.**
   - Order by dependency; **scope-overlap check before marking chunks parallelizable:** compare the chunks' file lists (plus the pack's `overlaps`) — any shared file → those chunks run sequentially.
   - Before any schema-bearing chunk, capture the domain model by invoking `linear-orchestration:domain-modeling` via the Skill tool (graceful only if it can't load — not an excuse to skip when a schema is involved).
   - **Docs-upkeep:** if the repo has a docs convention (`docs/**`, a docs-sync rule, a CLAUDE.md docs policy), behavior/workflow/config-changing chunks MUST include "update owning docs" as acceptance criteria or a dedicated docs-sync chunk.
   - **Code-quality gate:** if the repo exposes quality tooling/standards, each code chunk's validation MUST include the relevant gates — enforced at review time by the **code-standards-checker** the worker spawns, which DISCOVERS and reads the repo's relevant standards/guides itself (via the plugin's bundled repo-docs MCP) and checks the diff against them, not just the ACs (planning side here; execution side there).
5. **Execute (self-managing workers)** — dispatch one `linear-worker` per ready chunk (**model from the complexity signal** via the Agent `model` override — haiku/sonnet/opus), **inline + explicit `{projectId, teamId, milestoneId, issueId}` + complexity**, then step back.
   - Each worker owns its chunk like a dev opening a PR: sets its issue **In Progress** → does the work → posts its own **findings** (+ `diff`) via MCP → **requests review** by spawning a **code-standards-checker** + a **linear-reviewer** (using the **namespaced** `subagent_type` `linear-orchestration:code-standards-checker` / `linear-orchestration:linear-reviewer`; reviewer model by complexity) → on fail, fixes + re-requests (≤2 rounds); on pass the reviewer sets **Done** → returns final status + any **relay** items.
   - Parallelize only disjoint scopes — and pass `isolation: worktree` **only** to chunks that actually run in parallel; sequential, solo, or dependent chunks run in place on the shared feature branch (see *Addressing & concurrency*).
   - **Docs-only chunks** skip the code-standards-checker and use a single docs-aware `linear-reviewer` — see *Defaults → Docs-only economy*.
6. **Relay & record** — the orchestrator's per-chunk duties:
   - **Post any `relay` items** a subagent couldn't write itself.
   - **Commit the chunk** to the epic's feature branch once its reviewer sets Done (see *Addressing & concurrency → Commit per chunk*).
   - At a worker's internal-retry cap without a pass — or a worker returning `blocked` on ambiguity — apply the `blocked` label and **escalate to the user via the prompt loop** (present the blocker + options), write the resolution into the **issue description** (it IS the spec), then re-dispatch.
   - Refresh the single **"Progress / Resume here" status update** on the project (`save_status_update`), listing done vs remaining issues (by id + milestone) + next action.
   - **Re-plan:** after each chunk lands, re-check the remaining open issues' descriptions against what actually shipped (renamed symbols, moved files, changed interfaces, a decision taken mid-chunk) and UPDATE any stale spec before its worker is dispatched.
7. **Converge** — when the epic's issues are all Done, run TWO final checks over the **integrated** result; BOTH must pass:
   - A `linear-reviewer` against the **milestone's** acceptance criteria (integration coherence, not just per-chunk).
   - A `code-standards-checker` over the **integrated diff** (whole epic vs the base branch), given `{milestoneId, projectId}` + that diff, so it discovers and checks the repo's standards/guides across the combined change (catching cross-chunk drift the per-chunk gates miss).
   - (For a **docs-only epic**, run ONE combined docs-review over the integrated set — ACs + links + grounding + doc-shape — instead of the reviewer + code-standards-checker pair.)
   - Pass → **deliver:** ask the user via the prompt loop how to land the epic's feature branch — open a PR, merge it, or leave it as-is — and execute the choice (never merge unasked); then the epic **Milestone** is complete (100%); **do NOT mark the per-repo Project completed — it's long-lived**; post a final status update (including where the work landed: PR link / merge commit / branch name) + satisfaction check.
   - Fail (either check) → status update with gaps; re-open issue(s) or add a remediation chunk. Blocked/deferred → `partial` label + status update. Abort/infeasible → cancel the milestone's open issues + note.

## Linear I/O (subagents write their own — attempt-then-relay)

- **Subagents post their OWN Linear updates** via the MCP (worker: findings + status; checker/reviewer: their comments; reviewer moves status). A permission allow-rule (`mcp__plugin_linear-orchestration_linear`) in `settings.json` pre-authorizes these.
- **Attempt-then-relay:** if a subagent's write is denied (auto-mode classifier) or errors, it MUST NOT fail — it records `{issueId, action, body/status}` in a `relay` array returned to its parent, which re-attempts and bubbles still-failing items up. The **orchestrator** is the guaranteed writer of last resort.
- Reads are always allowed. The orchestrator owns project/milestone/issue **creation** and the status update.

## Status map

Todo → In Progress (worker start) → In Review (worker requests review) → Done (reviewer pass) / In Progress (fail → loop). `blocked` label at the retry cap; abandoned/infeasible → Canceled. **Epic completion = its Milestone reaching 100%** (the per-repo Project stays open). Full vocabulary: Todo, In Progress, In Review, Done, Canceled.

**Adapt to the team first:** before creating issues, `list_issue_statuses` for `TEAM` and map to its actual states; if one is missing (e.g. **In Review**), use the nearest (review still works with the chunk left In Progress). Same for labels: verify `agent-task`/`blocked`/`partial` exist for `TEAM`; `create_issue_label` first if not (Linear silently ignores unknown labels/states).

## Invariants

- Workers get fully-specified chunks addressed by **explicit IDs** + complexity; they self-manage build + standards-check + review.
- **Chunk file scopes are evidence-based** — they come from a `repo-scout` context pack, never from priors; parallel dispatch only after the explicit scope-overlap check. The scout is read-only and never talks to the user.
- **Subagents write their own Linear updates; relay up only on a write error** — never silently drop one.
- **No parent "epic" issue** — the epic is a **Milestone**. The per-repo **Project** is the long-lived container and is **never marked completed**.
- Linear is the source of truth; on resume read the project's status update, then re-read open issues (statuses authoritative).
- **A chunk's issue description IS its spec — keep it current.** When a mid-epic decision changes a chunk, UPDATE that issue's description, not only a milestone status-update or comment. The worker, `code-standards-checker`, and `linear-reviewer` read the issue body (not the comments); a stale description makes the standards-checker enforce the old spec and fail correct work as a false positive.
- Nests inside the existing prompt loop; follows `agent-orchestration` delegation rules. Companion skills are invoked **via the Skill tool** by their namespaced ids — `linear-orchestration:grilling`, `linear-orchestration:grill-with-docs`, `linear-orchestration:domain-modeling` (the `/name` shorthand is NOT a slash command here — always call the Skill tool). "Graceful" means: fall back only when the Skill tool genuinely can't load the skill — never as a default reason to skip grilling or domain-modeling on work that needs it.

## Defaults

- Team: resolved **per project** (team-agnostic; `Ai agents` only a preferred fallback). Project: per-repo, **long-lived**. Epic = **Milestone**. Chunks = **Issues** (label `agent-task`). Labels: `agent-task`, `blocked`, `partial`.
- Models: **per task by complexity** via the Agent `model` override (frontmatter `model` is a fallback) — worker haiku/sonnet/opus from the complexity signal; checker haiku/sonnet likewise. **Reviewers are sonnet or opus only — never haiku** (too weak to be a reliable verdict gate). **Scout tiers:** quick mode → haiku, deep mode → sonnet (never opus — it's a scout pass, not analysis). **Council members:** sonnet; opus for security-critical/high-blast-radius decisions. Worker internal review-retry cap: 2.
- **Docs-only economy:** a chunk (or epic) whose scope is entirely markdown / `docs/**` with no source change uses a SINGLE docs-aware `linear-reviewer` — it verifies the ACs **plus** links resolve, claims are grounded to `path:line`, and doc-shape/terminology is consistent — and **skips the code-standards-checker** (code gates like lint/typecheck/tests don't apply to markdown, and the remaining doc checks overlap the reviewer). Run the docs reviewer on **sonnet** (reviewers are never haiku; opus only for health-critical doc sets). Prefer compact/targeted `read_doc` reads for grounding lookups; on **incremental** docs epics scope the audit to changed docs + their link-neighbors rather than re-reading the full set. At convergence for a docs epic, run ONE combined docs-review, not a reviewer + checker pair.
- **Bundled docs specialist:** for a docs-only chunk or a convergence doc-audit/remediation, the orchestrator MAY dispatch the bundled `docs-maintainer` agent (generic, repo-agnostic; docs-only with source read-only; returns a handoff and posts its own Linear updates attempt-then-relay) instead of a generic `linear-worker`. **A docs-maintainer spawns nothing, so the orchestrator owns its review loop:** on the handoff, spawn the single docs-aware `linear-reviewer` yourself; on fail, re-dispatch the docs-maintainer with the fix-list (same 2-round cap, then `blocked`); the reviewer — never the docs-maintainer, never the orchestrator alone — sets Done.
