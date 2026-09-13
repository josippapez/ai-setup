---
name: pr-standard
description: 'The bar a pull request has to clear to merge with no review comments, and the procedure for scoring a PR against it. Covers the PR-level properties (one reason to exist, size, tests that fail on base, description, dependencies, commits, CI) that the always-on rules do not; the hunk-level half is the mergeable-change rule.'
when_to_use: 'Before opening a PR, when asked whether a PR is ready, and when reviewing a PR against a fixed standard rather than hunting for bugs. Triggers: "is this PR ready", "review this PR against the standard", "would you sign off on this", "score this PR", "what would a reviewer flag", "nothing to change?", "PR checklist", "before I open the PR", "grade the last N PRs". Use /code-review or exhaustive-code-review when the question is "does this code have bugs"; use this when the question is "does this PR meet the bar".'
---

# pr-standard

A PR gets "nothing to change" when every hunk has an observed case and every PR-level property below holds. The hunk-level properties are the always-on rules (`evidence-first` Gate 2, `llm-coding-guidelines` §2 §3 §5, `mergeable-change`). This skill adds the properties that exist only at the PR level, and the procedure for scoring a PR.

**The one thing that most often costs a PR its sign-off: a hunk nobody asked for and no test covers.** If you cannot name the observed case for a hunk, delete it.

## The standard

| Property | Holds when |
|---|---|
| **One reason to exist** | The title, `type(scope): description`, covers 100% of the diff. No drive-by rename, "while I'm here" refactor, or unrelated formatting. A second fix is a second PR. |
| **Clean base** | Branched from fresh `origin/main`, rebased before opening. Rebase during review only to resolve a conflict, and say so in a comment. Force-pushing mid-review erases the reviewer's context. |
| **Holdable size** | Under roughly 400 hand-written lines. Lockfiles, generated code, snapshots, and mechanical renames are excluded from the count. Larger work is split by layer (migration, then API, then UI). |
| **Every hunk justified** | Each hunk traces to a request, bug, failing test, or measurement. Absence of a guard is a finding to report, not a licence to add it. Fixes name the cause, not the symptom. |
| **Tests that fail on base** | One test per claimed behaviour, failing on the base branch. Refactors: suite passes before and after, no new tests. API changes get an integration test against the real store; UI changes get a component or hook test; a user path worth protecting gets the end-to-end case. |
| **Reads like its file** | Same naming, error shapes, query patterns, and comment density as the file it lives in. Simplest thing that works. |
| **Dependencies called out** | A new dependency has its own line in the description: why stdlib and installed deps do not cover it, and what it costs. |
| **Own orphans only** | Imports and helpers the change stranded are removed. Nobody else's dead code is touched. |
| **Explanation lives in code** | If a hunk needs a paragraph in the description to make sense, that paragraph is a comment next to the hunk, or the hunk is split out. |
| **Description** | What changed, why it was needed, how to verify. Breaking changes and manual steps (run a migration, set a variable) called out. Says what was deliberately left out and why. Not a debugging transcript. |
| **Commits** | Either the repo squash-merges and commits are irrelevant, or each commit builds and passes on its own so bisect works. Know which. |
| **Green on the PR head** | CI passes on the exact commit under review. A local run is the pre-push habit, not the proof. |

## Repo invariants

Some rows have a repo-specific form: which file owns the schema, which module validates env, which auth gates must never widen silently. Take those from the repo's CLAUDE.md, contributing guide, or `repo-docs` (`find_docs`). If the repo names none, score the generic row and report that no repo-specific invariant is documented. Do not invent one.

## Scoring a PR

1. **Fetch everything, not just the diff.** `gh pr view <n> --json title,body,commits,statusCheckRollup,baseRefName,additions,deletions,files` and `gh pr diff <n>`. Read the description and the commit list before the code.
2. **Size the diff honestly.** Subtract generated files, lockfiles, and snapshots before comparing against 400.
3. **Walk hunks, not files.** For each hunk ask: which sentence of the title or description covers it, and which test fails without it. Record hunks with no answer to either question with `file:line`.
4. **Score every row.** Verdict is `pass`, `fail`, or `n/a` with a reason. Each `fail` carries `file:line` or a quote from the description. An `n/a` names why the row cannot apply (no dependency added, no migration).
5. **Verdict.** "Nothing to change" only when every applicable row is `pass`. Otherwise list the fails, most expensive first, each as one sentence a reviewer would post.

Output shape, in this order: the verdict line, the fail list, the score table, unverified rows (a check that could not be run: CI status hidden, base branch deleted). Nothing else.

## Not this

- Do not hunt for bugs here. That is `/code-review` or `exhaustive-code-review`. A bug found in passing is reported under **Every hunk justified** with its `file:line`.
- Do not score from the description alone. A description claiming tests were added is checked against the diff.
- Do not fix anything while scoring.
- Do not soften a `fail` to a `pass` because the PR is already merged. The score is about the standard, not the outcome.

## Calibrating the standard

When the standard is new to a team, score the last three merged PRs. Each `fail` on a PR that merged fine is either a PR that was worse than it looked or a row that is stricter than the team wants. Report both readings and let the team decide which rows to keep.

## References

- `mergeable-change` rule — the hunk-level half of this bar
- `evidence-first`, `llm-coding-guidelines` — observed case, YAGNI, surgical changes, root cause
- [exhaustive-code-review](../exhaustive-code-review/SKILL.md) — the bug hunt, when that is the question
