# Routing matrix — OpenCode

This file is the **single authority** for specialist predicates. Read it immediately before every dispatch. Record each row evaluated as `dispatched` or `skipped: <reason>` in the current issue or epic. Empty required input means skip, never a synthetic pass. Pass every listed precomputed input verbatim.

Reviewers and checkers append comments only. Workers change issue status at non-concurrent lifecycle points; the orchestrator changes status at convergence. Store mechanics are owned by `store-protocol.md`.

| Specialist | Phase | Exact predicate | Required precomputed inputs | Role | Output / store writer | OpenCode name and model policy |
|---|---|---|---|---|---|---|
| Repo scout, quick | Intake | Tracked non-trivial task has code-answerable intake gaps and no complete current context pack | apparent scope, listed questions, repo root | Advisory | JSON context; no store write | `repo-scout`; Free |
| Repo scout, deep | Explore | Confirmed scope is not already covered end-to-end by a current pack | pinned spec, candidate areas/chunks | Blocking before decomposition | JSON context; orchestrator persists pack | `repo-scout-luna`; Luna |
| Grilling skill | Intake | Non-trivial spec has genuine unresolved scope/AC/term/constraint gaps | scout answers and remaining questions | Blocking | Main agent updates pinned spec | `grilling`; main agent skill call |
| Grill-with-docs | Intake | Above predicate plus domain-heavy/schema-bearing work | scout context and terms | Blocking | Main agent plus domain docs | `grill-with-docs` |
| Council member | Refine | User delegated an unresolved high-impact technical decision and approved council use; skip AC-prescribed/trivial decisions | decision, context slice, one lens | Advisory proposals; synthesized decision blocks | Strict JSON; orchestrator records approved ADR | `council-member-luna`; 3–4 parallel; `council-member` Sol for high-risk |
| Domain modeling | Refine/Decompose | Schema-bearing work or approved decision changes domain language/model | approved decision, glossary/schema context | Blocking before affected chunk | ADR/glossary written by main agent | `domain-modeling` skill |
| Design lead | Design | UI/visual/layout work lacks a complete approved concrete design specification | pinned spec, UI context, supplied visual inputs | Blocking before UI decomposition | Design pack; orchestrator records approval | `design-lead`; `design-lead-sol` for large/novel UI |
| Impl planner | Plan | New epic has at least 3 chunks, or a changed Description/dependency invalidates existing waves | issue spec/slice, sibling roster | Blocking for authoritative waves | JSON plan; orchestrator edits specs/frontmatter | `impl-planner`; `impl-planner-sol` high complexity; max 6 then group |
| Solution reuse scout | Execute pre-worker | `solution_reuse_signals` is non-empty because chunk proposes custom machinery, dependency/integration, or likely repo/native/platform/framework/library/package functionality | exact signals, issue spec, installed package/version context | Advisory; accepted result blocks worker until folded into Description | JSON only; orchestrator edits Description | `solution-reuse-scout`; Luna; use installed `agent-browser` only when browser-required |
| Docs maintainer, editor | Execute | Docs-only chunk, or supplied `owning_docs` is non-empty and docs editing is explicitly in scope | exact owning docs, editor mode, ACs | Implementation role; independently reviewed | Findings comment only; orchestrator owns status | `docs-maintainer`; Free |
| MD worker | Execute | Ready issue has authoritative wave/dependencies and is not routed to solo docs-maintainer | complete issue Description, absolute paths, complexity | Lifecycle coordinator | Findings/comments and issue status | `md-worker-free` trivial, `md-worker-terra` low, `md-worker-luna` normal, `md-worker-sol` high-risk |
| Test specialist | Worker build | Source behavior changed **and** exact `test_surface` is non-empty | test surface, changed behavior, issue paths | Blocking build input | Tests plus findings comment; no status | `test-specialist`; Luna; sequential after implementation |
| Code standards checker | Worker review / Converge | Exact `applicable_documented_standards` list is non-empty | standards path + scope + clauses, diff, paths | Blocking | Verdict comment only | `code-standards-checker` Terra, `-luna` normal, `-sol` disputed/high-risk |
| Quality gates checker | Worker review / Converge | Exact `non_test_quality_commands` list is non-empty | commands verbatim, repo/worktree root, paths | Blocking | Command-result comment only | `quality-gates-checker`; Terra; never tests |
| MD reviewer | Worker review / Converge | Always for implemented work; docs-only uses this as the single combined docs gate | ACs, diff/result, actual state, paths | Blocking | AC/correctness/scope/root-cause verdict comment only | `md-reviewer` Luna; `md-reviewer-sol` high-risk |
| Regression checker | Worker review / Converge | Exact `test_surface` includes a runnable existing suite | suite command/scope, changed files, paths | Blocking; `skipped` is not pass | Suite verdict comment only | `regression-checker`; Luna |
| Implementation quality reviewer | Worker review / Converge | Change contains substantive source edits; skip docs-only, config-only, generated, and mechanical changes | diff, preflight/spec, package evidence, paths | Blocking | Reuse/simplification/root-cause-quality verdict comment only | `implementation-quality-reviewer`; Luna |
| Docs maintainer, auditor | Converge | Docs-only epic, or integrated behavior/workflow/config change has non-empty aggregate `owning_docs` | exact aggregate owning docs, auditor mode, integrated diff | Blocking | Freshness verdict comment only; never status | `docs-maintainer`; Free/Luna if risk warrants |
| WCAG reviewer | Converge | UI epic and recorded accessibility scope is in-scope | approved baseline, integrated UI, paths | Blocking | WCAG verdict comment only | `wcag-reviewer`; Luna, `wcag-reviewer-sol` high-risk |
| Visual fidelity gate | Converge | UI epic was built against a visual reference | approved concrete visual spec, running UI | Blocking | Main-agent evidence/result in EPIC | Main orchestrator browser/design tools; no subagent |

## Worker review set

After findings and `In Review`, dispatch all applicable read-only review rows in parallel. Docs-only work dispatches only the docs-aware MD reviewer. The worker joins all dispatched gates, sets `Done` only when every blocking gate passes, otherwise returns to `In Progress`, fixes, and retries at most twice. Missing nested task capability is relayed to the orchestrator; it never converts to approval.

## Convergence set

Aggregate per-issue slices only across integrated changed files, deduplicate exact entries, and re-evaluate this matrix. Integrated MD review is always blocking. Other convergence gates are conditional above. Any failure reopens affected work or creates remediation.
