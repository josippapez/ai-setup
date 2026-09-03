# Decompose through Converge (nightly)

This file owns phases 5–9. Read `routing.md` before every dispatch, `store-protocol.md` before store writes, and `platform.md` for Claude mechanics.

## 5. Decompose

On new work, instantiate `../templates/PROJECT.md` if absent, `../templates/EPIC.md`, and one `../templates/issue.md` per chunk. On resume, update existing files rather than recreating them.

**Fewer, larger chunks.** Measured on past epics, a worker's fixed cost (loading the spec, the context slice, the store, the repo) is paid once per chunk regardless of size, so the nightly rule is: target 2–4 chunks per epic; merge chunks that write the same files; fold any chunk under roughly 30 changed lines into a neighbour unless it is a dependency the next wave needs landed first. Split only for parallelism between disjoint scopes or for an independently reviewable risk-tagged change.

Each issue Description must be executable without rediscovery: objective, exact scope/files, constraints, ACs, validation, handoff, complexity, `risk` tags, files/reuse, all five verbatim conditional slices with explicit empties, and applicable design/ADR context. For schema chunks, persist the domain model first.

Set `complexity` and `risk` on every issue; together they pick the build model and the review mode (see `platform.md`). Seed provisional waves from dependencies, overlap, and shared files.

## 6. Plan

Evaluate impl-planner routing. Give each planner its issue, context/design slice, and complete sibling roster. Join results; derive authoritative `wave` and `depends_on`, separate conflicts, apply corrections to Descriptions, surface unresolved questions. Below the predicate, record skip and set a safe ordering directly. On resume preserve waves; re-plan only materially changed issues.

## 7. Execute

Dispatch the lowest open wave only after prerequisites are visible in its workspace. Disjoint concurrent chunks run in place; overlapping or unknown-overlap chunks get worktrees.

Before each builder, evaluate solution-reuse routing and fold accepted findings into the Description.

Set the issue to `In Progress`, then dispatch `md-builder` with absolute store paths, complexity, and risk tags; it reads the Description and every slice from `issuePath`, so the prompt does not repeat them or the builder's own process. The builder builds, runs the validation commands, runs `non_test_quality_commands` and the runnable suite from `test_surface` verbatim, checks supplied `owning_docs`, appends one findings comment with the diff and pasted command output, and returns. It never spawns agents and never moves status.

On return: evaluate the test-specialist row; if dispatched, wait for it. Then set the issue to `In Review` and check whether a review batch is due (`routing.md`, Review batches). If it is, dispatch `batch-reviewer` and continue dispatching ready builders without waiting for the review.

## 8. Review, fix, and record

Join each batch-reviewer result. Per issue: pass → `Done`; fail → dispatch `md-fixer` with the exact fix-list and scope, set `In Progress`, and on its return set `In Review` and queue the issue for the next batch. Two fix rounds max per issue, then label `blocked`, persist the fix-list, and ask the user.

Apply relays. Integrate source only through user-approved mechanics. Refresh PROJECT after each batch. Before the next wave, compare pending Descriptions with landed symbols/interfaces and correct stale specs. Convert out-of-scope `docs_impact` into a pending docs scope.

## 9. Converge

When every issue is `Done`, inspect the integrated diff. Aggregate and deduplicate conditional slices for integrated changed files. Dispatch one integrated `batch-reviewer` over the whole epic (epic ACs, coherence, all documented standards, full test suite run), plus the conditional convergence rows. Enabled gates may run in parallel and append to EPIC; the orchestrator joins them and owns remediation.

Any blocking failure reopens affected issues or creates a remediation issue, refreshes PROJECT, and returns to Execute. Passing all gates proceeds to SKILL close-out, `store-protocol.md`, and `close-out-brief.md`. Run `bench/orchestration-cost.cjs` and put the epic's measured cost and wall-clock in the brief. No landing action is implicit.
