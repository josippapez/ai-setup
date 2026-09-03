# Gate through Design

This file owns detailed phases 0–4. Read `routing.md` before every dispatch and `platform.md` for Claude names/tools.

## 0. Gate

Engage per SKILL Gate. Resolve the main repo root. Before scouting, verify repo-docs index readiness; reindex when absent/empty and degrade to targeted file search only when indexing genuinely cannot run. Detect resume before creating a new epic.

## 1. Intake

Gap-check scope, ACs, terms, constraints, validation, design inputs, and competing interpretations. A gap is genuinely undefined; never ask the user to choose what ACs already prescribe.

When routing applies, quick-scout apparent areas and code-answerable questions before grilling. Ask the user only remaining decisions/preferences. Default to a grilling skill for non-trivial incomplete specs; use grill-with-docs for domain/schema work. If a skill genuinely cannot load, use the question loop rather than skipping intake. The main agent is the only user-facing participant.

For UI work, ask whether design input exists. A screenshot/Figma/mockup is a reference, not automatically a complete written specification. Note design-tool authentication needs for Design. Intake ends only when objective, scope, ACs, constraints, terms, and unresolved decisions are explicit.

## 2. Explore

Deep-scout confirmed scope unless current quick context already covers it end-to-end or resume carries valid slices. Parallel scouts only for genuinely disjoint areas. Require grounded `path:line` evidence and per-area:

- exact files/roles, reuse candidates, blast radius, overlaps, and risks;
- `applicable_documented_standards` with path, changed-file scope, and clauses;
- `owning_docs` with applicability reason;
- exact `non_test_quality_commands` excluding tests;
- `test_surface` with targeted/full runnable commands and scope;
- `solution_reuse_signals` with evidence;
- explicit `[]` plus reason for every empty slice.

Surface scout open questions to the user. The pack is mandatory evidence for chunk scopes and all later routing. Docs-only work may use quick depth if sufficient.

## 3. Refine

Council routing applies only to unresolved high-impact technical decisions delegated by the user. Offer the council and proceed after user approval. Use 3–4 lenses: always simplicity/YAGNI and repository fit, plus relevant security, migration/operability, maintenance/licensing, or performance. Synthesize one recommendation, expose tradeoffs, and obtain approval. Escalate to adversarial scoring only for high-risk/high-blast-radius decisions.

Persist approved architecture/domain decisions in EPIC; use domain-modeling for schema-bearing work. Skip and record trivial, user-constrained, or AC-prescribed choices.

## 4. Design

Applies only to UI/visual/layout/design work. If no complete design exists, dispatch design lead with pinned spec, UI context, and supplied references. Ensure available design MCPs are connected before relying on them. Convert visual references into a concrete written specification: layout, positioning, spacing, sizing, typography/color tokens, component structure, asset handling, and reuse plan. Existing sibling UI is reusable only after verifying it matches the target.

Ask whether WCAG 2.2 A/AA review is in scope; recommend it for user-facing UI and record the answer in EPIC so resume does not re-ask. When in scope, include the accessibility baseline in the design pack and later route WCAG review. Present design direction and open brand/tone choices for approval. Persist the approved pack and per-chunk slices before decomposition. Skip Design for non-UI or complete approved design, recording why.
