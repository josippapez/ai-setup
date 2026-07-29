# Orchestration Claude Plugin

Markdown-tracked task orchestration for non-trivial work. The main agent grills and scouts the task, stores the epic under a git-ignored `.orchestration/` directory, plans dependency waves, dispatches self-managing workers, and converges blocking specialist gates. No external tracker, account, or authentication is required.

The compact state machine lives in [`skills/markdown-orchestration/SKILL.md`](skills/markdown-orchestration/SKILL.md). Only `SKILL.md` auto-loads; it requires explicit on-demand absolute reads of bundled references. Routing predicates are authoritative only in `references/routing.md`, store/concurrency only in `references/store-protocol.md`, and phase detail in the intake/execution references.

## Markdown store

- `<repo-root>/.orchestration/.gitignore` contains `*`; the root `.gitignore` is untouched.
- `PROJECT.md` is the long-lived per-repo resume index.
- `<epic>/EPIC.md` owns epic ACs, context, decisions, convergence records, and append-only session IDs.
- `<epic>/issues/NN-slug.md` owns one chunk's frontmatter, current Description/spec, and append-only Comments.
- Every agent receives explicit absolute store paths. Comments use append-only writes; the worker/orchestrator remains the single status writer.

## Responsibility catalog

- `repo-scout` — read-only context pack. Per scope it precomputes files/reuse plus applicable documented standards, owning docs, non-test quality commands, test surfaces, and solution-reuse signals. Empty results are explicit.
- `solution-reuse-scout` — conditional, read-only pre-worker research for custom mechanisms, dependencies/integrations, and likely repository/native/library/package solutions.
- `impl-planner`, `council-member`, `design-lead` — retain their conditional planning, architecture, and UI design responsibilities.
- `md-worker` — lifecycle/status/retry coordinator. It builds one chunk and dispatches only gates enabled by persisted predicates.
- `code-standards-checker` — checks only supplied documented standards/clauses; it never discovers standards or runs commands.
- `quality-gates-checker` — runs only supplied non-test quality commands; it never runs tests or reviews standards.
- `md-reviewer` — checks ACs, functional correctness, scope, actual state, and root-cause correctness.
- `implementation-quality-reviewer` — blocking reuse/simplification/root-cause quality gate for substantive source changes only.
- `test-specialist`, `regression-checker`, `wcag-reviewer`, and visual-fidelity review retain their existing explicit predicates.
- `docs-maintainer` remains both editor and auditor, dispatched only for docs-only work or non-empty scoped owning docs.

Every dispatched specialist appends its own verdict and relays failed writes. Every inapplicable specialist is recorded as `skipped: <reason>` rather than a fabricated pass.

## Layout

- `.mcp.json` + `runtime/` — self-contained repo-docs MCP (`find_docs`, `list_docs`, `read_doc`, `find_libs`, dependency graph tools).
- `hooks/` — SessionStart dependency setup and index lifecycle hooks.
- `skills/markdown-orchestration/` — compact dispatcher, `references/` (`routing`, `store-protocol`, `intake-design`, `execution`, `platform`), and canonical `templates/` for PROJECT, EPIC, and issues.
- Other `skills/` — grilling, domain-modeling, and design/accessibility companions.
- `commands/` — `/markdown-orchestration`, `/reindex`, and `/repo-docs-ignore`.
- `agents/` — the specialists cataloged above and their contract test.

## Browser research portability

The existing repository-owned `agent-browser` skill is not copied into this plugin: its source contains HCP-specific startup guidance and assumes a separately installed global CLI/browser, so copying it would not make the plugin self-contained or portable. The solution scout prefers direct repo/docs/web tools and retains WebFetch/WebSearch. OpenCode uses its already-installed `agent-browser` skill when browser interaction is genuinely required.

## Prerequisites

None for tracking. The store is created automatically. The bundled repo-docs dependencies install on SessionStart; WCAG lookups use the bundled CLI skill on demand. If the filesystem is read-only, the workflow reports that persistence is unavailable and falls back to in-session tracking.
