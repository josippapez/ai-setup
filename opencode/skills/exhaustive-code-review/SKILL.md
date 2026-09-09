---
name: exhaustive-code-review
description: 'Review that finishes instead of stopping. Freeze the review surface in a ledger, fan out one subagent per review lane over the whole surface, and require a verdict for every unit so a later re-run cannot surface issues that were sitting there the whole time. Use for any review that has to be complete rather than representative: before a merge or release, on a change you will not get to look at twice, and any time a previous review "finished" and a re-run then found pre-existing problems. Triggers: "exhaustive review", "full review", "review everything", "did you check all of it", "you missed this last time", "review it again properly", "why did the second pass find more", "complete audit of this branch". Use instead of a single-pass review when the diff spans more than a couple of files or the cost of a miss is high. NEVER start it unasked: it spends six subagents per pass and every pass re-reads the whole surface, so Step 0 is a confirmation gate. On a plain "review this" with no word asking for completeness, run a single-pass review and offer this one in a line instead.'
---

# exhaustive-code-review

A normal review stops when the reviewer stops finding things. That is a feeling, not a
finish line, so the next run over the same code finds more. This skill replaces the
feeling with a check: **the review is done when every unit of the surface has a recorded
verdict from every lane** — not when the findings dry up.

Three things make it hold:

1. The surface is **enumerated and frozen before any reviewing**, so "how much is left" is a number.
2. Lanes run as **separate subagents with their own context**, so no lane gets crowded out by another and no file gets a thinner look for being 40th.
3. Every unit needs an explicit verdict, **including "checked, clean"**. Silence is treated as uncovered, not as clean.

## What it costs

Thoroughness here is bought with usage, not cleverness, and the bill is real:

- **Six subagents per pass**, one per lane, each reading **every** unit rather than a slice.
- The re-dispatch of a lane that left cells empty is more reading on top of that.
- A fix-then-re-review cycle is **another six**, because the fixes moved the code.
- Cost scales with units, and units grow faster than files: each changed file contributes its
  hunks, its whole self, and every caller of every symbol it changed.

So it earns its keep on a merge you cannot re-open, and wastes a lot of budget on a diff that
one careful pass would have covered. It is not the default review, and it is never the review
you start because a request contained the word "review".

## Step 0 — Confirm before spending

**Ask, every time, before enumerating anything.** The only exception is a user message that
already named this skill or asked for exhaustive, complete, or full coverage in their own
words. Even then, say the agent count in one line before you dispatch.

Sizing comes first, because the user cannot judge the price without it. Run
`git diff --stat <base>...HEAD` and report: files changed, lines changed, and the rough unit
count. Then put the choice to them with the `question` tool, offering at least:

| Option | What runs |
|---|---|
| **Full six lanes** | The whole skill as written below |
| **Reduced lanes** | Only the lanes the diff can actually violate (see Cheaper modes) |
| **One ordinary pass** | A single-pass review, no fan-out, no ledger |

If the answer does not come back, do not default to running it. Fall back to a single-pass
review and say that is what you did.

## Cheaper modes

Lanes are defined in Step 2. Dropping lanes is legitimate when the diff cannot violate them. Dropping lanes to save time on
a diff that *can* violate them is the early stopping this skill exists to prevent, so name the
lanes you dropped and why in the report.

| Diff shape | Lanes worth running |
|---|---|
| Docs, comments, copy only | F alone |
| Config, CI, dependency bumps | C, D |
| Pure rename or move | D, F |
| Test-only change | E, A |
| Anything touching auth, money, user data, or migrations | All six, no reduction |

Below roughly three units, run the lanes yourself in sequence and still write the ledger. Six
subagents to read forty lines costs more than they can possibly find.

## Why the last review stopped early

Recognise these in yourself. Each one ends a review with the code unread.

| What it feels like | What it is |
|---|---|
| "The remaining files are more of the same" | Untested guess about files you did not open |
| "I have enough findings to be useful" | A findings budget. There is no such budget |
| "Higher-signal to report fewer things" | A reporting rule applied at the looking stage |
| Context is filling up, so wrap up | Attention ran out before the surface did |
| Reviewed each file once, noting whatever stood out | One pass per file means the first thing noticed wins and the rest never gets looked for |
| Re-review after fixes only reads the fix | The fix moved the code; the rest was never covered in the first place |

## Step 1 — Freeze the surface

Before reading a single line for review, write the ledger. Path:
`.git/exhaustive-review/<branch>.md` — inside `.git`, so it is never committed and never
shows up in `git status`. Create the directory if needed.

Enumerate the surface from the diff (`git diff --stat <base>...HEAD`, or the working tree
for uncommitted work; ask which base if it is not obvious):

- **Changed units** — every hunk, widened to its enclosing function, class, or top-level
  block. A hunk reviewed without its enclosing scope is how "the caller already checked
  that" goes unverified.
- **Touched files, whole** — each file the change touches, in full. This is where the
  pre-existing issues live. They are in scope for **reporting**, never for fixing unasked.
- **Blast radius** — every caller of every changed symbol, whether or not that file is in
  the diff. In a repo with `.codegraph/`, one `codegraph_explore` call over the changed
  symbol names gives callers, callees, and dependents. Otherwise grep every changed
  exported name.

Write each unit as one ledger row with a stable id, and record the count. Generated files,
lockfiles, and vendored directories are excluded **by name in the ledger**, not silently.

```markdown
| id | unit | kind | A | B | C | D | E | F |
|----|------|------|---|---|---|---|---|---|
| u1 | src/auth/session.ts:40-88 createSession | changed |  |  |  |  |  |  |
| u2 | src/auth/session.ts (whole) | touched |  |  |  |  |  |  |
| u3 | src/api/login.ts:112 calls createSession | caller |  |  |  |  |  |  |
```

The unit list is frozen from here. It grows only when a lane reports a caller nobody
enumerated; it never shrinks.

## Step 2 — Fan out one subagent per lane

Six lanes, dispatched with the native `task` tool **in a single message so they run at once**, each over the **whole**
unit list. Not one agent per file, and not one agent doing all six: a lane is a way of
looking, and lanes crowd each other out inside one context.

| Lane | Looks for |
|---|---|
| **A. Correctness** | Edge cases, boundaries, off-by-one, null and empty inputs, control flow, error paths, partial failure, resource cleanup, wrong-but-plausible logic |
| **B. State and concurrency** | Races, `await` gaps, ordering assumptions, cancellation, stale closures and caches, shared mutable state, idempotency, retry safety |
| **C. Security and data** | Trust boundaries, authz and authn, injection, unsafe deserialization, secrets and PII in logs or errors, migrations, transaction scope, data loss on failure |
| **D. Contracts and blast radius** | Every call site of every changed symbol against its new behavior: signatures, nullability, thrown errors, ordering, defaults, config and env keys, public API and wire-format compatibility |
| **E. Tests and verification** | Would any test fail if this change were reverted; tests weakened, skipped, or deleted; untested error paths; assertions that cannot fail |
| **F. Reuse, simplification, consistency** | Duplicated logic, hand-rolled stdlib or an installed dependency, dead code the change orphaned, naming and conventions of surrounding code, comments and docs the change made false |

Model tier: **C and D take the strongest tier** — a missed authz hole or an unupdated call
site is the expensive kind of miss. A, B, E, F run mid-tier. See `agent-orchestration` for
routing.

Each lane prompt carries, in full (subagents inherit no context):

- The complete ledger unit list with ids, and the base ref plus the diff command to reproduce it.
- That lane's definition, verbatim, and that it owns **only** that lane. A correctness finding spotted by lane F is passed along, not suppressed, but F does not go hunting outside its lane.
- **The return shape: one row per unit id.** Verdict is `finding`, `clean`, or `n/a` with a reason. `clean` means it was read and nothing was found. A missing row is a gap, not a pass.
- Each finding: unit id, `file:line`, what breaks, the concrete input or state that triggers it, severity, and `introduced` or `pre-existing`.
- **No findings budget and no severity floor.** Report everything found, at its real severity. Filtering happens at reporting, never at looking. A lane returning "nothing major" without per-unit rows has not finished.
- Read-only: no edits, no commits, no test runs that write.

## Step 3 — Merge and close the gaps

Fill the ledger from the lane reports, then check the grid, not the vibe:

1. **Any empty cell is uncovered.** Re-dispatch that lane with just its missing unit ids. Continue the same agent by id rather than starting fresh.
2. **Any lane that returned prose instead of per-unit rows is uncovered in full.** Re-dispatch it with the return shape restated.
3. **New callers reported by lane D become new units**, and every lane owes a verdict on them. That is the one legitimate way the surface grows.
4. Only when the grid is full is the review finished. Say the number out loud in the report: units covered, lanes run, findings by severity.

Deduplicate across lanes by `file:line` plus cause, keeping the clearest description. Two
lanes reaching the same finding is confirmation, not noise.

## Step 4 — Report

Findings are ordered by severity, each with `file:line`, the failing case, and the
`introduced` or `pre-existing` label. Pre-existing findings go in their own section: they
are the user's call, and fixing them unasked violates the surgical-changes rule.

Every finding carries evidence you actually gathered — a line you read, a call site you
opened, a command you ran. A lane that reasoned from the shape of the code without opening
it produced a guess, and it gets labelled `unverified` or re-run. Claims about library
behavior get fetched, not recalled (`external-facts`).

## Step 5 — Re-review after the fixes

This is where the original complaint comes from. Fixes move the code, so the surface moves.

- Rebuild the unit list against the **new** diff. Fixed units come back changed; the fixes themselves are new units; a fix that touched a new file drags that file in whole.
- A unit keeps its earlier verdict **only if its content is byte-identical**. Compare, do not assume.
- Everything else goes back through the lanes.
- A re-run that surfaces something on an unchanged unit means that unit's cell was filled without being read. Say so in the report rather than presenting it as a new discovery.

## Not this

- Do not fix anything during the review. Reviewing and editing in one pass is how the second half of the surface gets skipped.
- Do not stop on the first serious finding to go discuss it. Finish the grid, then report everything at once.
- Do not skip lanes because the diff "is only a rename" or "is only config". A rename is lane D's whole job; config is lane C's.
- Do not fan out on a two-line diff, and do not fan out at all before Step 0 gets an answer.

## References

- [agent-orchestration](../agent-orchestration/SKILL.md) — lane dispatch, tier choice, and following up with an agent that returned partial output
- [opensrc](../opensrc/SKILL.md) — reading the installed source when a lane's claim depends on library behavior
- [accessibility](../accessibility/SKILL.md) — the a11y audit that lanes do not cover; run it alongside for UI changes
