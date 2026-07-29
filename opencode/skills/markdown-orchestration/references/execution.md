# Decompose through Converge

This file owns phases 5–9. Read `routing.md` before every dispatch, `store-protocol.md` before store writes, and `platform.md` for OpenCode mechanics.

## 5. Decompose

On new work, instantiate `../templates/PROJECT.md` if absent, `../templates/EPIC.md`, and one `../templates/issue.md` per cohesive chunk. On resume, update existing files rather than recreating them.

Each issue Description must be executable without rediscovery: objective, exact scope/files, constraints, ACs, validation, handoff, complexity, files/reuse, all five verbatim conditional slices with explicit empties, and applicable design/ADR context. Add owning-doc work to scope/ACs when applicable. For schema chunks, persist the domain model first.

Seed provisional waves from dependencies, overlap, and shared files. Keep chunks cohesive and independently reviewable; separate scopes that cannot mutate safely together.

## 6. Plan

Evaluate impl-planner routing. Give each planner its issue, context/design slice, and complete sibling roster. Planners conceptually dry-run actual code and report plan, produces, consumes, conflicts, corrections, split/merge proposals, and questions. Join results; topologically derive authoritative `wave` and `depends_on`, separate conflicts, apply corrections to Descriptions, and surface unresolved questions. Cap fan-out per routing/platform policy. Below the predicate, record skip and establish safe authoritative ordering directly.

On resume preserve waves. Re-plan only materially changed issues or dependency edges.

## 7. Execute

Dispatch lowest open wave only after prerequisites are visible in its workspace. Concurrent chunks must have disjoint scopes; only overlapping concurrent chunks need worktree isolation, and disjoint ones run in place (see platform reference). Derive overlap from the impl-planner `conflicts` output, and isolate whenever it is unknown.

Before each worker, evaluate solution-reuse routing. Its search order is repository reuse, installed/native/current library docs and source, then targeted web research. No speculative web search for simple mechanical work. Fold accepted findings into Description before worker dispatch.

Dispatch worker with absolute store paths, complexity, complete Description, and exact slices. The worker performs its self-contained lifecycle: `In Progress`, build/root-cause fix, conditional sequential test specialist, supplied owning-doc check, findings append, `In Review`, applicable parallel review gates, join, status, and at most two fix/review rounds. Every routing decision is appended. Reviewers never move status. Docs-only work uses the single docs-aware reviewer route; docs-maintainer may implement under its routing row.

## 8. Relay and record

Apply relays. Integrate source only through user-approved platform mechanics. Refresh PROJECT after each chunk. Before the next worker, compare pending Descriptions with actual landed symbols/interfaces and correct stale specs. Re-plan affected issues if dependency edges changed. Convert out-of-scope supplied `docs_impact` into a pending docs scope/chunk.

At retry cap, label blocked, persist fix-list, and ask the user for resolution. On resolution, update Description before redispatch.

## 9. Converge

When every issue is Done, inspect the integrated diff/current state. Aggregate and deduplicate conditional slices only for integrated changed files. Evaluate every convergence row in routing and record dispatch/skip.

Integrated MD review always checks epic ACs and coherence. Conditionally run scoped standards, non-test quality commands, regression suite, implementation quality, owning-doc audit, WCAG, and visual fidelity. Docs-only epics use one combined docs-aware review. Enabled independent gates may run in parallel and append to EPIC; the orchestrator joins them and owns remediation status changes.

Any blocking failure reopens affected issues or creates a remediation issue from the template, refreshes PROJECT, and returns to Execute. Passing all gates proceeds to SKILL close-out and `store-protocol.md`. No landing action is implicit.
