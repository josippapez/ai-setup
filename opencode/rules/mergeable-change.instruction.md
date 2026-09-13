---
applyTo: "**"
name: mergeable-change
description: Writing-time properties a change MUST have to merge without review comments, beyond what evidence-first and llm-coding-guidelines already enforce - tests that fail without the change, invariants at the lowest layer, honest types, justified dependencies, reversible migrations, stated auth. The PR-level half (scope, size, description, CI) lives in the pr-standard skill.
---

# mergeable-change — write it so the review has nothing to say

`evidence-first` decides *whether* a hunk exists (observed case). `llm-coding-guidelines` decides *how much* code (YAGNI, surgical, root cause). This rule covers what is left: the properties a reviewer checks on a hunk that already earned its place.

- **Tests fail without the change.** A behaviour change ships one test per behaviour it claims, written so it fails on the base branch. A pure refactor ships no new tests; the existing suite passes before and after and the description says behaviour is unchanged. No snapshot-only coverage of logic. No test that asserts the implementation back to itself.
- **Invariants at the lowest layer that can hold them.** A database constraint beats a service guard, which beats a client check. Put the rule where it cannot be bypassed, then test it there.
- **Auth is stated, not implied.** A new endpoint, handler, or job names which credentials it accepts and why, in code or description. A change that touches an auth bypass, a dev-only gate, or anything that mints or extends credentials says so in its own line of the description.
- **Migrations are forward-only and additive where possible.** A destructive migration ships a hand-written down migration and a note on how restore was tested.
- **Config goes through the repo's validated entry point.** If the repo has one module that reads and validates environment variables, every new variable goes through it. No ad hoc `process.env` reads.
- **A new dependency is a change nobody asked for** until the description says why stdlib and the installed dependencies do not cover it, and what it costs (size, maintenance, licence).
- **Types are honest.** No `any`, no cast that papers over a shape mismatch. If the shape is wrong, fix the shape.
- **Comments explain surprises only.** A comment that restates the line is deleted. A comment that says why the code is not the obvious code stays. Deliberate simplifications carry a `debt:` marker (see `llm-coding-guidelines` §2).
- **Second thing to fix means second branch.** If a hunk cannot be described by the change's own title, it is not part of this change.

The check before you push: for each hunk, name the observed case, the test that fails without it, and the reason it lives at this layer. Any hunk missing one of the three is deleted or split out.
