---
name: markdown-orchestration
description: Use when a non-trivial, multi-step task should be tracked and executed by subagents — multi-file or multi-step work that needs decomposition, an epic/ticket to execute end-to-end, or a previously tracked epic to resume. Also on explicit asks like "track this" or "orchestrate this". The main agent follows this skill as the orchestrator; the skill body is the authoritative workflow.
---

# Orchestration (markdown-tracked)

The MAIN agent is the orchestrator and prompt-loop owner. Plugin overview & one-time setup: `../../README.md`.

## When to engage

- Engage for non-trivial, multi-step tasks (multiple files/steps, or one that needs decomposition).
- Skip trivial one-offs — handle them inline.
- Honor explicit overrides ("track this" / "skip tracking").
- Tracking is a **local in-repo markdown store** — no external service, no account, no auth. The orchestrator creates it on first use (see *Markdown store*). Nothing to authenticate; if the store can't be created (read-only FS), warn and fall back to in-session todos.

## Markdown store

One local store per repo, git-ignored, fully file-based (zero manual setup):

- **Location:** `<repo-root>/.orchestration/` — resolved to an **absolute path** by the orchestrator and passed top-down (see *Addressing*). The orchestrator **creates the folder** if absent and, in the SAME step, writes a **self-ignoring `.orchestration/.gitignore` containing `*`** so the entire store (that file included) is untracked — the repo's **root `.gitignore` is never touched**. The store is never committed. (Idempotent: if `.orchestration/.gitignore` already exists, leave it.)
- **`PROJECT.md`** = one per repo/product — **long-lived; it never completes**. Holds a product overview + the single **"Progress / Resume here"** section (done vs remaining issues by path + next action).
- **`<epic-slug>/EPIC.md`** = an **epic / story / ticket** — a cohesive unit of work. Holds that unit's goal + acceptance criteria + a compact **Context pack** section (per-area files, reuse candidates, gates), plus (when they apply) the approved **Design direction**, **ADRs**, and **accessibility scope**. This *is* the epic — there is no parent "epic issue".
- **`<epic-slug>/issues/NN-<slug>.md`** = a chunk under the epic. **One file per chunk**, holding the spec AND its comment thread:

```markdown
---
id: NN-<slug>
epic: <epic-slug>
status: Todo            # Todo | In Progress | In Review | Done | Canceled
labels: [agent-task]    # + blocked / partial as needed
complexity: low         # low | medium | high
---
# <Chunk title>

## Description
<!-- The spec — this IS the ticket body. Keep it current. -->
Objective · exact scope/files · constraints · acceptance criteria · validation commands · handoff format · complexity signal · context-pack slice (+ design-pack slice for a UI chunk).

---
## Comments
<!-- Append-only thread below the description. Each writer appends its OWN section with shell `>>` (never a read-modify-write edit); never rewrite another's section or the Description. -->

### <YYYY-MM-DD> · worker — findings
…what shipped + validation output + per-criterion self-check, then a fenced ```diff``` block…

### <YYYY-MM-DD> · code-standards-checker — PASS|FAIL
…gates run + violations citing their source…

### <YYYY-MM-DD> · md-reviewer — verdict: Done ✅ | In Progress ❌
…per-criterion pass/fail + fix-list; status moved in the frontmatter above…
```

- **Status lives in the frontmatter `status:` field**; labels in `labels:`. Reviewers move status by editing that field. Timestamps come from `date +%F` (agents run it via Bash).

## Addressing & concurrency (multi-project safe)

- **Everything is addressed by explicit absolute file path, passed top-down.** The orchestrator resolves `{storeRoot, epicDir, issuePath}` (all absolute, rooted at the **main repo root**) and passes the exact paths into each subagent prompt. **No subagent infers the store from cwd/git** — critical because a worker in an isolated worktree has a *different* cwd, yet must still write to the main repo's store. There is no global "active epic".
- Because the store is git-ignored, it does **not** propagate into a git worktree. Always address it by the absolute main-repo path so worktree workers write to the one canonical store.
- Overlapping file scopes in the SAME repo run sequentially; disjoint scopes — or different repos — run in parallel. Different issues are different files, so parallel chunks never contend for one store file. **Within a single issue there ARE concurrent writers** — the worker spawns its checker and reviewer in parallel and both append to the same `ISSUE.md`. This is safe because **all comment writes are append-only** (`>> file` — concurrent appends don't clobber) and the frontmatter **`status:` field is changed by only ONE writer at a non-concurrent moment** (the worker at start / In Review / after both reviewers return; the orchestrator at Converge). No two agents ever rewrite the file at once.
- **Worktree isolation is only for *concurrent* writers.** Pass `isolation: worktree` to a worker **only** when two or more mutating workers run **in parallel** (disjoint scopes in the same repo, or different repos) and would otherwise clobber each other. Worktree isolation is expensive — don't pay for it on a chunk that runs alone or sequentially.
- **Sequential, solo, or dependent chunks run in place** (no worktree) on the epic's shared feature branch, so each builds naturally on the last. A fresh worktree forks from the *base* commit, so an isolated dependent chunk would NOT see its dependency's work, and a solo chunk's changes get stranded uncommitted inside a throwaway worktree.
- **Integration is the orchestrator's job.** Before dispatching a chunk that depends on a prior one, land the prior chunk's work onto the epic's feature branch (merge its worktree branch, or — for in-place chunks — it's already there). Never dispatch a dependent chunk against a base that lacks its dependency. Workers leave changes uncommitted / on their branch; the orchestrator owns branch creation and integration (and on the default branch, **branches first**). **Commit per chunk:** once a chunk's reviewer sets Done, the orchestrator commits its changes to the epic's feature branch (one commit per chunk, referencing the issue id; for a worktree chunk, merge its branch) — so per-chunk diffs stay clean, a blocked chunk resets to the last commit instead of hunk surgery, and Converge's integrated diff is simply `git diff base...epic`. (The `.orchestration/` store is git-ignored, so it never appears in these commits.)

## Phases

0. **Gate** — engage vs inline.
1. **Intake (grill)** — orchestrator ↔ user only. **Never decompose on an incomplete spec.**
   - **Gap-check the task** before decomposing: scan for missing/ambiguous elements (unclear scope, undefined acceptance criteria, ambiguous terms, unstated constraints, competing interpretations).
   - **A "gap" is something the ticket genuinely leaves undefined or ambiguous — NOT something its acceptance criteria already prescribe.** If the ACs already specify the approach (which layer/component owns a behavior, the expected outcome, the validation), treat it as *decided*: proceed on the ACs and do NOT prompt the user to re-choose it — that is noise, and it reads as asking them to decide what the ticket already decided. Prompt only for genuinely undefined gaps; when a gap sits next to an AC-specified part, ask ONLY about the undefined slice, not the whole area.
   - **Pre-grill scout:** before grilling, dispatch the bundled `repo-scout` agent (`subagent_type: markdown-orchestration:repo-scout`, **quick** mode, haiku) over the task's apparent area, passing the code-answerable gaps as questions — grill the user ONLY with what the scout couldn't answer from the repo (its `open_questions` + genuine preference/scope decisions).
   - **Default to grilling for any non-trivial task** — invoke the grill skill via the **Skill tool** unless the spec is *provably* complete (scope, acceptance criteria, and all terms already pinned with no competing interpretation), in which case a quick scope confirmation suffices.
   - **Which skill:** domain-heavy / schema-bearing → invoke `markdown-orchestration:grill-with-docs` (via the Skill tool); simpler → invoke `markdown-orchestration:grilling`. Only if the Skill tool cannot load it, fall back to a question-tool interview (graceful — never block on a missing skill, but do NOT use "graceful" as a reason to skip grilling a task with real gaps).
   - **Design-input gate:** UI/visual/layout/design task with no design supplied (Figma, mockup, screenshot, wireframe, written spec, reference UI) → note it for the **Design phase**: ask the user for design input if they have any, otherwise the `design-lead` proposes an accessible direction there. Never decompose UI chunks before a design direction is approved.
2. **Explore (deep scout)** — once the spec is pinned, dispatch the bundled `repo-scout` (`subagent_type: markdown-orchestration:repo-scout`, **deep** mode, sonnet; parallel scouts only for genuinely disjoint multi-area epics) with the confirmed scope.
   - It returns the **context pack**: per-area file lists (chunk-scope precision), reuse candidates (existing patterns/utilities — the highest-value output), blast radius, cross-area `overlaps`, quality gates, docs conventions, and `open_questions`.
   - **Surface `open_questions` to the user before decomposing** — they are intake gaps the code couldn't answer.
   - The pack grounds the council and is the REQUIRED evidence base for decompose's file scopes — **never decompose from priors when a scout can look.**
   - Docs-only epics may downgrade to a quick-mode scout (haiku). Skip entirely when intake's quick scout already covered the confirmed scope end-to-end, or on a **resume** (the epic already exists — `EPIC.md` carries the pack; jump to Decompose's resume check and re-scout only a remaining chunk whose spec lacks its slice).
3. **Refine (architecture council)** — *conditional; fires only when the user delegated a technical decision.* **Never decompose before a surfaced delegated decision is resolved.**
   - If intake surfaces open **high-impact technical decisions the user left to us** (architecture, structure, data model, security posture, tech/library choice), the orchestrator **auto-offers a council** rather than deciding unilaterally, and proceeds on the user's OK.
   - A council = **3–4 bundled `council-member` agents in parallel** (`subagent_type: markdown-orchestration:council-member`), each given the decision question, the context-pack slice for the affected area, and ONE assigned lens; each returns a strict-JSON proposal (tradeoffs, risks, `path:line` evidence, rejected alternatives, confidence).
   - **Pick the lenses to match the decision type** — always **simplicity/YAGNI** + **repo-convention fit**, then per type: **security** (auth, data exposure, trust boundaries), **migration & operability** (data models, schema changes), **maintenance/licensing/bus-factor** (library choices), **performance/scale** (hot paths).
   - Councilors run on **sonnet**; **opus** for security-critical or high-blast-radius decisions (never haiku).
   - The orchestrator **synthesizes one recommendation** (grafting the best of the runners-up) and presents it with the key tradeoffs for **user approval**. **Default is lightweight** (parallel proposals → synthesis); **escalate to a scored judge-panel / adversarial cross-critique only for security-critical or high-blast-radius decisions.**
   - Record the approved approach in **`EPIC.md`** (write it as an ADR by invoking `markdown-orchestration:domain-modeling` via the Skill tool; if it can't load, inline the ADR text directly — don't skip recording the decision).
   - Skip entirely when the decision is trivial, fully constrained by the user, or **already prescribed by the ticket's acceptance criteria** (don't convene a council — or ask — over a choice the ACs already made).
4. **Design** — *conditional; fires only for a UI/visual/layout/design epic.* **Never decompose UI chunks before a design direction is approved.**
   - If the epic has a real UI surface and no complete design is supplied, dispatch the bundled `design-lead` agent (`subagent_type: markdown-orchestration:design-lead`, sonnet; opus for a large/novel UI system), given the pinned spec, the scout pack's UI slice, and any design input the user provided.
   - It returns a **design pack**: direction + a design-token map grounded in the repo's existing design system, a component-reuse plan, and (when in accessibility scope) a **WCAG 2.2 A/AA baseline** — grounded in the bundled `wcag` MCP, degrading to a baked-in baseline if the server is absent. Reuse existing design-system primitives over anything bespoke.
   - **Accessibility scope (ask the user):** for a UI epic, the orchestrator **asks the user via the prompt loop whether a WCAG 2.2 A/AA accessibility review is needed** — recommend it for user-facing web/mobile UI, note it's usually unnecessary for non-user-facing/internal surfaces. The answer sets scope: in-scope keeps the design a11y baseline AND the Converge `wcag-reviewer`; out-of-scope skips both. **Record the decision in `EPIC.md`** (accessibility: in-scope / out-of-scope) so it isn't re-asked on resume.
   - **Surface its `open_questions` (brand/tone/reference decisions) to the user and present the direction for approval** — design is a user-facing decision, like the council recommendation. Proceed on the user's OK.
   - Record the approved direction (and, when accessibility is in scope, the a11y baseline) in **`EPIC.md`** (a compact "Design direction" section, alongside the Context pack), and feed each UI chunk its `per_chunk_slices` entry (design notes + any a11y notes) so workers build to the approved design instead of improvising.
   - Skip entirely for non-UI epics, or when the user supplied a complete, unambiguous design (a quick confirmation then suffices).
5. **Decompose** — turn the pinned spec + context pack into the epic on disk (`EPIC.md` + issue files).
   - First, **resume check**: ensure the store exists, then look for the epic's `<epic-slug>/` dir; if it exists, read `PROJECT.md`'s "Progress / Resume here" + the issue files' frontmatter `status:` (authoritative) and rebuild from open issue statuses — continue it.
   - Otherwise: ensure `.orchestration/` (with its self-ignoring `.gitignore` = `*`) + `PROJECT.md` exist (create if not); create the epic dir with `EPIC.md` (goal + acceptance criteria + a compact **Context pack** section: per-area files, reuse candidates, gates — so resume and the council re-read it); write one **issue file** (`issues/NN-<slug>.md`) per chunk with the frontmatter + Description + an empty Comments section.
   - Each issue MUST be self-contained: objective, exact scope/files, constraints, acceptance criteria, validation commands, handoff format, **complexity signal** (low/medium/high — also in frontmatter), and its **context-pack slice** (the pack's files + reuse candidates + gates for THIS chunk's scope — so the worker starts warm instead of re-exploring). **For a UI chunk, also include its design-pack slice** (design notes + a11y baseline from the Design phase) so it builds to the approved, accessible design. **File scopes come from the context pack, not priors.**
   - Order by dependency; **scope-overlap check before marking chunks parallelizable:** compare the chunks' file lists (plus the pack's `overlaps`) — any shared file → those chunks run sequentially.
   - Before any schema-bearing chunk, capture the domain model by invoking `markdown-orchestration:domain-modeling` via the Skill tool (graceful only if it can't load — not an excuse to skip when a schema is involved).
   - **Docs-upkeep:** if the repo has a docs convention (`docs/**`, a docs-sync rule, a CLAUDE.md docs policy), behavior/workflow/config-changing chunks MUST include "update owning docs" as acceptance criteria or a dedicated docs-sync chunk. (Workers also run a docs self-check at build time and report any unforeseen stale docs as `docs_impact` — the backstop to this plan-time step.)
   - **Code-quality gate:** if the repo exposes quality tooling/standards, each code chunk's validation MUST include the relevant gates — enforced at review time by the **code-standards-checker** the worker spawns, which DISCOVERS and reads the repo's relevant standards/guides itself (via the plugin's bundled repo-docs MCP) and checks the diff against them, not just the ACs (planning side here; execution side there).
6. **Execute (self-managing workers)** — dispatch one `md-worker` per ready chunk (**model from the complexity signal** via the Agent `model` override — haiku/sonnet/opus), **inline + explicit `{storeRoot, epicDir, issuePath}` + complexity**, then step back.
   - Each worker owns its chunk like a dev opening a PR: sets its issue **In Progress** (frontmatter) → does the work → **docs self-check** (flags owning docs its change left stale — updates in-scope ones, reports out-of-scope ones as `docs_impact`) → appends its own **findings** (+ `diff`) to the issue's Comments → sets **In Review** → **requests review** by spawning a **code-standards-checker** + a **md-reviewer** **in parallel** (using the **namespaced** `subagent_type` `markdown-orchestration:code-standards-checker` / `markdown-orchestration:md-reviewer`; reviewer model by complexity), each of which **appends** its verdict comment to the issue → **the worker applies the frontmatter status on join** (both pass → **Done**; either fails → back to **In Progress**, fix in scope + re-request, ≤2 rounds) and appends its own follow-up comment → returns final status + any **relay** items.
   - Parallelize only disjoint scopes — and pass `isolation: worktree` **only** to chunks that actually run in parallel; sequential, solo, or dependent chunks run in place on the shared feature branch (see *Addressing & concurrency*).
   - **Docs-only chunks** skip the code-standards-checker and use a single docs-aware `md-reviewer` — see *Defaults → Docs-only economy*.
7. **Relay & record** — the orchestrator's per-chunk duties:
   - **Apply any `relay` items** a subagent couldn't write itself (a file-write that was denied/errored) — the orchestrator is the writer of last resort.
   - **Commit the chunk** to the epic's feature branch once its reviewer sets Done (see *Addressing & concurrency → Commit per chunk*).
   - At a worker's internal-retry cap without a pass — or a worker returning `blocked` on ambiguity — add the `blocked` label (frontmatter) and **escalate to the user via the prompt loop** (present the blocker + options), write the resolution into the **issue's Description** (it IS the spec), then re-dispatch.
   - Refresh the single **"Progress / Resume here"** section in `PROJECT.md`, listing done vs remaining issues (by path + epic) + next action.
   - **Re-plan:** after each chunk lands, re-check the remaining open issues' Descriptions against what actually shipped (renamed symbols, moved files, changed interfaces, a decision taken mid-chunk) and UPDATE any stale spec before its worker is dispatched.
   - **Consume `docs_impact`:** if a worker reports owning docs its change left stale (out-of-scope docs it correctly didn't touch), fold "update owning docs" into a pending chunk's acceptance criteria or add a dedicated docs-sync chunk — don't drop it. This is the worker-time backstop to Decompose's plan-time docs-upkeep, so unforeseen docs drift is still caught.
8. **Converge** — when the epic's issues are all Done, run the final checks over the **integrated** result (TWO by default, THREE for a UI epic); ALL must pass. The orchestrator spawns them in parallel; each **appends** its verdict to `EPIC.md`, and the orchestrator applies any status/label change on join (single writer):
   - A `md-reviewer` against **`EPIC.md`'s** acceptance criteria (integration coherence, not just per-chunk).
   - A `code-standards-checker` over the **integrated diff** (whole epic vs the base branch), given `{epicDir}` + that diff, so it discovers and checks the repo's standards/guides across the combined change (catching cross-chunk drift the per-chunk gates miss).
   - **For a UI epic that is in accessibility scope** (see Design → Accessibility scope — run only when the user confirmed a WCAG review is needed), also run a `wcag-reviewer` (`subagent_type: markdown-orchestration:wcag-reviewer`, sonnet) over the integrated UI — a WCAG 2.2 A/AA audit grounded in the bundled `wcag` MCP; it appends its verdict to `EPIC.md`. This is the accessibility gate for UI work; a fail is handled like any Converge fail (remediation chunk).
   - (For a **docs-only epic**, run ONE combined docs-review over the integrated set — ACs + links + grounding + doc-shape — instead of the reviewer + code-standards-checker pair.)
   - Pass → **deliver:** ask the user via the prompt loop how to land the epic's feature branch — open a PR, merge it, or leave it as-is — and execute the choice (never merge unasked); then mark the **epic** complete (set every issue Done; note completion in `EPIC.md`); **do NOT delete or complete `PROJECT.md` — it's long-lived**; refresh the "Progress / Resume here" section (including where the work landed: PR link / merge commit / branch name) + satisfaction check.
   - Fail (either check) → refresh "Progress / Resume here" with gaps; re-open issue(s) (status back to In Progress) or add a remediation chunk. Blocked/deferred → `partial` label + status note. Abort/infeasible → set the epic's open issues Canceled + note.

## Store I/O (subagents write their own — attempt-then-relay)

- **Subagents write their OWN updates** directly to the markdown store (worker: its findings + follow-up comments AND the frontmatter status; checker/reviewer/wcag-reviewer: their verdict comment sections only). Comment writes are **append-only**: append a new `### <date> · <agent> — …` section under `## Comments` in the exact `issuePath` given, with shell `>>` — never a read-modify-write edit, and never rewrite another writer's section or the Description. The **frontmatter `status:` is changed by a single writer only** (the worker after its parallel reviewers join, or the orchestrator at Converge), so a status change never races a concurrent append.
- **Attempt-then-relay:** local writes rarely fail, but if a write is denied (permission) or errors, a subagent MUST NOT fail — it records `{issuePath, action, body/status}` in a `relay` array returned to its parent, which re-attempts and bubbles still-failing items up. The **orchestrator** is the guaranteed writer of last resort.
- Reads are always allowed. The orchestrator owns store/epic/issue **creation**, the store's self-ignoring `.orchestration/.gitignore` (`*`), and the "Progress / Resume here" section.

## Status map

Todo → In Progress (worker start) → In Review (worker requests review) → Done (worker applies on reviewer pass) / In Progress (fail → loop). `blocked` label at the retry cap; abandoned/infeasible → Canceled. Status is the frontmatter `status:` field; labels are the `labels:` list. **Epic completion = all its issues Done** (`PROJECT.md` stays). Full vocabulary: Todo, In Progress, In Review, Done, Canceled.

## Invariants

- Workers get fully-specified chunks addressed by **explicit absolute paths** + complexity; they self-manage build + standards-check + review.
- **Chunk file scopes are evidence-based** — they come from a `repo-scout` context pack, never from priors; parallel dispatch only after the explicit scope-overlap check. The scout is read-only and never talks to the user.
- **Subagents write their own updates to the store; relay up only on a write error** — never silently drop one.
- **No parent "epic" issue** — the epic is `EPIC.md`. `PROJECT.md` is the long-lived container and is **never deleted**.
- The store is the source of truth; on resume read `PROJECT.md`'s "Progress / Resume here", then re-read issue frontmatter statuses (authoritative).
- The store lives at the **main repo root** and is **git-ignored via its own `.orchestration/.gitignore` (`*`)** — the repo's root `.gitignore` is never modified; address it by absolute path so worktree workers write to the one canonical store, and it never lands in a commit.
- **A UI epic gets a design direction before its UI chunks are decomposed.** Accessibility is **optional by default**: the orchestrator asks the user at the Design phase whether a WCAG 2.2 A/AA review is needed and records the answer in `EPIC.md`. Only when the user confirms does the `design-lead` bake a WCAG 2.2 A/AA baseline into the approved design (recorded in `EPIC.md` + each UI chunk's spec) and the `wcag-reviewer` audit the integrated UI at Converge — both grounding in the bundled `wcag` MCP, degrading to the baked-in baseline only if the server is absent.
- **A chunk's issue Description IS its spec — keep it current.** When a mid-epic decision changes a chunk, UPDATE that issue file's Description, not only a `PROJECT.md` note or a comment. The worker, `code-standards-checker`, and `md-reviewer` read the Description (not the comment thread); a stale Description makes the standards-checker enforce the old spec and fail correct work as a false positive.
- Nests inside the existing prompt loop; follows `agent-orchestration` delegation rules. Companion skills are invoked **via the Skill tool** by their namespaced ids — `markdown-orchestration:grilling`, `markdown-orchestration:grill-with-docs`, `markdown-orchestration:domain-modeling` (the `/name` shorthand is NOT a slash command here — always call the Skill tool). "Graceful" means: fall back only when the Skill tool genuinely can't load the skill — never as a default reason to skip grilling or domain-modeling on work that needs it.

## Defaults

- Store: per-repo `.orchestration/` (git-ignored, long-lived). Epic = `EPIC.md` dir. Chunks = issue files (label `agent-task`). Labels: `agent-task`, `blocked`, `partial`.
- Models: **per task by complexity** via the Agent `model` override (frontmatter `model` is a fallback) — worker haiku/sonnet/opus from the complexity signal; checker haiku/sonnet likewise. **Reviewers are sonnet or opus only — never haiku** (too weak to be a reliable verdict gate). **Scout tiers:** quick mode → haiku, deep mode → sonnet (never opus — it's a scout pass, not analysis). **Council members:** sonnet; opus for security-critical/high-blast-radius decisions. **Design-lead & wcag-reviewer:** sonnet (design-lead → opus for a large/novel UI system); never haiku. Worker internal review-retry cap: 2.
- **Docs-only economy:** a chunk (or epic) whose scope is entirely markdown / `docs/**` with no source change uses a SINGLE docs-aware `md-reviewer` — it verifies the ACs **plus** links resolve, claims are grounded to `path:line`, and doc-shape/terminology is consistent — and **skips the code-standards-checker** (code gates like lint/typecheck/tests don't apply to markdown, and the remaining doc checks overlap the reviewer). Run the docs reviewer on **sonnet** (reviewers are never haiku; opus only for health-critical doc sets). Prefer compact/targeted `read_doc` reads for grounding lookups; on **incremental** docs epics scope the audit to changed docs + their link-neighbors rather than re-reading the full set. At convergence for a docs epic, run ONE combined docs-review, not a reviewer + checker pair.
- **Design & accessibility (UI epics):** a UI/visual/layout/design epic runs the **Design phase** (`design-lead` → design pack: direction, token map grounded in the existing design system, component-reuse plan, and — when accessibility is in scope — a WCAG 2.2 A/AA baseline) before Decompose. The accessibility gate is **optional by default**: the orchestrator asks the user whether a WCAG 2.2 A/AA review is needed (recommended for user-facing UI), and only on confirmation does the design baseline + the Converge `wcag-reviewer` run — the choice recorded in `EPIC.md`. When in scope, both ground in the bundled `wcag` MCP and degrade to a baked-in A/AA baseline if it's absent. Skip the Design phase entirely for non-UI epics.
- **Bundled docs specialist:** for a docs-only chunk or a convergence doc-audit/remediation, the orchestrator MAY dispatch the bundled `docs-maintainer` agent (generic, repo-agnostic; docs-only with source read-only; returns a handoff and appends its own store updates attempt-then-relay) instead of a generic `md-worker`. **A docs-maintainer spawns nothing, so the orchestrator owns its review loop:** on the handoff, spawn the single docs-aware `md-reviewer` yourself; on fail, re-dispatch the docs-maintainer with the fix-list (same 2-round cap, then `blocked`); the reviewer — never the docs-maintainer, never the orchestrator alone — sets Done.
