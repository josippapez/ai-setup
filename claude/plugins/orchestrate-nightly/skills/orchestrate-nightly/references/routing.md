# Routing matrix — Claude (nightly)

This file is the **single authority** for specialist predicates in the nightly workflow. Read it immediately before every dispatch. Record each row evaluated as `dispatched` or `skipped: <reason>` in the current issue or epic. Empty required input means skip, never a synthetic pass. Pass every listed precomputed input verbatim, by pointer when it is already persisted: anything in the issue or epic file is referenced by absolute path, not copied into the prompt. The prompt adds only paths, `complexity`/`risk`, batch or round facts, and inputs that are not yet in the store.

Only the orchestrator dispatches agents. Builders, reviewers, and fixers append comments; the orchestrator alone moves issue status. Store mechanics are owned by `store-protocol.md`.

| Specialist | Phase | Exact predicate | Required precomputed inputs | Role | Output / store writer | Claude name and model policy |
|---|---|---|---|---|---|---|
| Repo scout, quick | Intake | Tracked non-trivial task has code-answerable intake gaps and no complete current context pack | apparent scope, listed questions, repo root | Advisory | JSON context; no store write | `orchestrate-nightly:repo-scout`; haiku |
| Repo scout, deep | Explore | Confirmed scope is not already covered end-to-end by a current pack | pinned spec, candidate areas/chunks | Blocking before decomposition | JSON context; orchestrator persists pack | `orchestrate-nightly:repo-scout`; sonnet |
| Grilling skill | Intake | Non-trivial spec has genuine unresolved scope/AC/term/constraint gaps | scout answers and remaining questions | Blocking | Main agent updates pinned spec | `orchestrate:grilling` (stable plugin); main agent Skill call |
| Grill-with-docs | Intake | Above predicate plus domain-heavy/schema-bearing work | scout context and terms | Blocking | Main agent plus domain docs | `orchestrate:grill-with-docs` (stable plugin) |
| Council member | Refine | User delegated an unresolved high-impact technical decision and approved council use | decision, context slice, one lens | Advisory proposals | Strict JSON; orchestrator records approved ADR | `orchestrate-nightly:council-member`; 3 parallel, sonnet |
| Domain modeling | Refine/Decompose | Schema-bearing work or approved decision changes domain language/model | approved decision, glossary/schema context | Blocking before affected chunk | ADR/glossary written by main agent | `orchestrate:domain-modeling` (stable plugin) Skill |
| Design lead | Design | UI/visual/layout work lacks a complete approved concrete design specification | pinned spec, UI context, supplied visual inputs | Blocking before UI decomposition | Design pack; orchestrator records approval | `orchestrate-nightly:design-lead`; sonnet |
| Impl planner | Plan | New epic has at least 3 chunks, or a changed Description/dependency invalidates existing waves | issue spec/slice, sibling roster | Blocking for authoritative waves | JSON plan; orchestrator edits specs/frontmatter | `orchestrate-nightly:impl-planner`; one/chunk, max 6 then group; sonnet |
| Solution reuse scout | Execute pre-build | `solution_reuse_signals` is non-empty | exact signals, issue spec, installed package/version context | Advisory; accepted result folded into Description before build | JSON only; orchestrator edits Description | `orchestrate-nightly:solution-reuse-scout`; sonnet |
| Docs maintainer, editor | Execute | Docs-only chunk, or supplied `owning_docs` is non-empty and docs editing is in scope | exact owning docs, editor mode, ACs | Implementation role; reviewed in the next batch | Findings comment only | `orchestrate-nightly:docs-maintainer`; sonnet |
| MD builder | Execute | Ready issue has authoritative wave/dependencies and is not routed to solo docs-maintainer | absolute paths (`issuePath` holds the Description and all slices, incl. `non_test_quality_commands` and `test_surface`), complexity, risk tags | Build only; runs supplied commands itself | Findings comment with command output; no status | `orchestrate-nightly:md-builder`; model from the complexity/risk table in platform.md |
| Test specialist | Execute, after build | Source behavior changed **and** exact `test_surface` is non-empty **and** the builder's findings report no tests added for the changed behavior | issue paths (`test_surface` and the builder's diff live there), changed behavior | Blocking build input | Tests plus findings comment; no status | `orchestrate-nightly:test-specialist`; sonnet |
| Batch reviewer | Review | A review batch is due: two finished chunks are `In Review`, or the wave's last chunk is `In Review`, or a chunk with a risk tag is `In Review` (reviewed solo) | batch id; per issue: `issuePath` (ACs, `applicable_documented_standards`, preflight, and builder findings live there), risk tags, round | Blocking; replaces md-reviewer, code-standards-checker, implementation-quality-reviewer | One verdict section per issue in the batch; no status | `orchestrate-nightly:batch-reviewer`; sonnet, opus if any chunk in the batch has a risk tag |
| MD fixer | Review, on fail | Batch reviewer returned a non-empty fix-list for an issue and the issue is under its retry cap | issue paths (the reviewer's fix-list and the scope live there), round | Applies the fix-list only | Follow-up findings comment; no status | `orchestrate-nightly:md-fixer`; haiku when every fix-list item names the file and the exact change, sonnet otherwise |
| Docs maintainer, auditor | Converge | Docs-only epic, or integrated behavior/workflow/config change has non-empty aggregate `owning_docs` | exact aggregate owning docs, auditor mode, integrated diff | Blocking | Freshness verdict comment only | `orchestrate-nightly:docs-maintainer`; sonnet |
| WCAG reviewer | Converge | UI epic and recorded accessibility scope is in-scope | approved baseline, integrated UI, paths | Blocking | WCAG verdict comment only | `orchestrate-nightly:wcag-reviewer`; sonnet |
| Visual fidelity gate | Converge | UI epic was built against a visual reference | approved concrete visual spec, running UI | Blocking | Main-agent evidence/result in EPIC | Main orchestrator browser/design tools; no subagent |

## Removed rows, and where their job went

- `md-worker` → `md-builder` (build only) plus orchestrator-owned review and status.
- `quality-gates-checker` → the builder runs `non_test_quality_commands` verbatim and pastes the output in its findings. The batch reviewer re-runs any command whose pasted output is missing or does not show a pass.
- `regression-checker` → the builder runs the supplied runnable suite from `test_surface` verbatim per chunk. At Converge the batch reviewer runs the full suite once over the integrated state.
- `md-reviewer`, `code-standards-checker`, `implementation-quality-reviewer` → `batch-reviewer`, one dispatch per batch with a sectioned checklist.

## Review batches

A batch is formed by the orchestrator at these moments, in priority order:

1. A risk-tagged chunk reaches `In Review`: review it alone, immediately, on opus.
2. Two untagged chunks are `In Review`: review them together on sonnet.
3. The wave has no more chunks to finish and at least one chunk is `In Review`: review whatever is waiting.

While a batch is under review, the orchestrator keeps dispatching the next ready builders. Review is off the critical path except for the final batch of the epic.

The reviewer returns one verdict per issue. Pass → orchestrator sets `Done`. Fail → orchestrator dispatches `md-fixer` with that issue's fix-list, then puts the issue back into the next batch. Cap: two fix rounds per issue, then label `blocked` and return to the user.

## Convergence set

Aggregate per-issue slices across integrated changed files, deduplicate, and re-evaluate this matrix. The integrated batch review is always blocking and includes the full test suite run. Other convergence gates are conditional above. Any failure reopens affected work or creates remediation.
