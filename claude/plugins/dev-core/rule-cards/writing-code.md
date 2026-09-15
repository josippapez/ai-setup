---
name: writing-code
description: Simplicity, surgical scope, root cause, and the properties a hunk needs to merge without review comments.
---

# Writing code

**Simplicity first.** The minimum code that solves the problem, nothing speculative. Stop at the first rung that works: does this need to exist at all (YAGNI); does the standard library cover it; is there a native platform or runtime feature; is it already an installed dependency; can it be one line; only then write the minimum working code. No features beyond what was asked. No abstractions for single-use code. No flexibility or configurability nobody requested. No error handling for impossible scenarios. No "while I'm here" refactors, renames, or hardening riding along with a fix. If you wrote 200 lines and it could be 50, rewrite it. Ask whether a senior engineer would call it overcomplicated.

**Surgical changes.** Touch only what you must. Do not improve adjacent code, comments, or formatting. Do not refactor what is not broken. Match existing style even where you would do it differently. Remove imports, variables, and functions that *your* change orphaned; mention pre-existing dead code rather than deleting it. The test: every changed line traces directly to the user's request.

**Root cause, not symptom.** Trace the failure to the exact line or condition before patching, and do not stop where it surfaces. No symptom-masking: do not swallow errors, wrap a bug in a defensive `try/catch`, add retries, sprinkle `?.` and null-guards, bump timeouts, or insert sleeps to paper over a race, unless the root cause is genuinely external and outside your control, and then say so explicitly. The fix is not done until you can explain *why* the bug happened, not just that it stopped reproducing.

**What a reviewer will check on a hunk that earned its place:**

- A behaviour change ships one test per behaviour it claims, written so it fails on the base branch. A pure refactor ships no new tests, passes the existing suite before and after, and says behaviour is unchanged. No snapshot-only coverage of logic.
- Invariants live at the lowest layer that can hold them: a database constraint beats a service guard, which beats a client check. Put the rule where it cannot be bypassed, then test it there.
- Types are honest. No `any`, no cast that papers over a shape mismatch. If the shape is wrong, fix the shape.
- A new dependency is a change nobody asked for until you say why the stdlib and the installed dependencies do not cover it, and what it costs.
- New environment variables go through the repo's validated config entry point, never an ad hoc `process.env` read.
- Migrations are forward-only and additive where possible; a destructive one ships a hand-written down migration.
- A new endpoint, handler, or job names which credentials it accepts and why.
- Comments explain surprises only. A comment restating the line is deleted; a comment saying why the code is not the obvious code stays.
- If a hunk cannot be described by the change's own title, it belongs on a second branch.

A deliberate simplification carries a `debt:` comment naming the ceiling and the upgrade path, for example `// debt: O(n^2) scan - fine under ~1k rows; add an index if it grows`.

**Guardrail:** never simplify away security, input validation at trust boundaries, error handling that prevents data loss, accessibility, or explicitly requested behavior.

Every hunk still has to clear Gate 2: name the observed case, or delete it.
