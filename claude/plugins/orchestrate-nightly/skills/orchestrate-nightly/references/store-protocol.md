# Store protocol

This file owns store schema, addressing, status, concurrency, relay, resume, and close-out. Use templates from `../templates/`; do not hand-copy embedded examples from other docs.

## Location and files

The canonical store is `<main-repo-root>/.orchestration/`. On first creation, create `.orchestration/.gitignore` containing exactly `*`; never alter the repository root `.gitignore`. The store is never committed.

- `PROJECT.md`: long-lived per-repo index from `../templates/PROJECT.md`. It never completes or gets deleted. It has one `Progress / Resume here` section.
- `<epic-slug>/EPIC.md`: epic goal, ACs, context pack, decisions, design/accessibility state, routing records, convergence results, and append-only sessions; create from `../templates/EPIC.md`.
- `<epic-slug>/issues/NN-slug.md`: one chunk's authoritative spec, routing context, status, and append-only comments; create from `../templates/issue.md`.

## Absolute addressing

Resolve `{storeRoot, epicDir, issuePath}` from the main repository root and pass absolute paths top-down. No subagent infers store location from cwd or git. Worktree agents still write to the one main-repo store because `.orchestration/` is absent from worktrees.

## Status and ownership

Vocabulary: `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`. Labels include `agent-task`, `blocked`, and `partial`.

Normal issue flow: `Todo → In Progress → In Review → Done`, or `In Review → In Progress` on review failure. In the nightly workflow the **orchestrator is the only status writer**: it sets `In Progress` before dispatching a builder or fixer, `In Review` when the builder or fixer returns, and `Done`/`In Progress` when it joins a batch-reviewer verdict. Builders, fixers, reviewers, scouts, planners, and docs-maintainers **never move status**; they append results only. The orchestrator moves status only when no dispatched agent for that issue is running.

## Append-only concurrency

Issue Description and frontmatter edits have one owner at a time. Comments are concurrent-safe only because each agent appends a complete new `### <date> · <agent> — ...` section with shell `>>`. Never read-modify-write Comments, edit another writer's section, or rewrite Description from a reviewer. The orchestrator is sole writer for initial files, issue Description corrections, EPIC frontmatter sessions, and PROJECT progress.

## Attempt then relay

Every assigned writer attempts its own write. If denied or errored, it returns `{issuePath, action, body|status}` in `relay` without failing the substantive result. Parents re-attempt and bubble unresolved relays upward. The orchestrator is writer of last resort. A relay must be applied or explicitly reported before completion.

## Worktrees

Store writes always target main-repo absolute paths. Source writes use platform isolation from `platform.md`. Parallel mutating chunks require disjoint scope; worktree isolation is required only when their scopes overlap or overlap is unknown, so disjoint parallel chunks run in place. Sequential/dependent chunks must see landed prerequisites. Never copy the store into, or commit it from, a worktree.

## Resume

Read PROJECT progress, EPIC, and all open issue frontmatter. Frontmatter status is authoritative over summaries. Append the current session ID to EPIC if absent; builders append their session to their own issue. Preserve existing waves unless changed specs/dependencies invalidate them. Refresh PROJECT immediately with the reconstructed next action.

## Close-out

An epic closes only when all issues are Done, every applicable convergence gate passed, every routing skip is recorded, and relays are resolved. Append the close-out brief (see `close-out-brief.md`) to EPIC `## Completion` verbatim as rendered to the user, so a later session inherits the explanation and not just the bookkeeping. Ask the user for landing choice; never commit/branch/merge/push/open a PR without explicit approval. Update EPIC completion and PROJECT's single progress section with actual landing location or `left uncommitted`. Re-read PROJECT and verify it is current before the satisfaction check. Never delete PROJECT.
