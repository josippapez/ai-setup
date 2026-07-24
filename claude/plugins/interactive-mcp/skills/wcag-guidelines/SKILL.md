---
name: wcag-guidelines
description: Use whenever accessibility (a11y) or WCAG comes up — building, reviewing, remediating, or auditing UI/markup for accessibility, or answering any WCAG 2.2 / WCAG 2.1 question — even when the user does not name WCAG explicitly. Covers success criteria (e.g. 1.1.1, 1.4.3, 2.4.7, 2.5.8), conformance levels A/AA/AAA, sufficient techniques and common failures, the WCAG glossary, and what changed in WCAG 2.2. Reach for it for color/contrast ratios, alt text, ARIA roles/states/attributes, accessible names, roles and labels, keyboard navigation and focus order, focus visible, form labels and errors, headings and landmarks, live regions, screen-reader behavior, semantic HTML, target/touch size, reflow, motion, and Section 508 / EN 301 549 / ADA conformance mapping — before writing, fixing, or citing accessibility requirements. Resolves via `npx @rawwee/wcag-cli <command>` (or global `wcag`).
---

# wcag-guidelines — WCAG 2.2 Lookup CLI

`@rawwee/wcag-cli` wraps the `wcag-guidelines-mcp` dataset as a standalone CLI. Invoke via `npx @rawwee/wcag-cli <command>` (or the global `wcag <command>` if installed globally). Output is markdown, and it costs 0 context tokens until you actually call it — no MCP tool schema sits in context.

## When to use

- You are about to write or review UI/markup and need to check what a success criterion actually requires
- You need to cite the correct conformance level (A/AA/AAA) for a criterion
- You need known techniques or common failures for a criterion
- You need a WCAG glossary term defined precisely
- You need to know what's new/changed in WCAG 2.2 vs 2.1

## Commands

**Core**
- `list-principles` — list the 4 WCAG principles (POUR)
- `list-guidelines` — list all guidelines
- `list-success-criteria` — list all success criteria
- `get-success-criteria-detail` — full detail for a success criterion
- `get-criterion <id>` — get one success criterion by number (e.g. `1.1.1`)
- `get-guideline <id>` — get one guideline by number
- `search-wcag <query>` — full-text search across WCAG content
- `get-criteria-by-level <level>` — list criteria at a conformance level (A/AA/AAA)
- `count-criteria` — count criteria, optionally by level

**Techniques**
- `list-techniques` — list all techniques
- `get-technique <id>` — get one technique by id
- `get-techniques-for-criterion <id>` — techniques mapped to a success criterion
- `search-techniques <query>` — full-text search across techniques
- `get-failures-for-criterion <id>` — known failure techniques for a criterion

**Glossary**
- `get-glossary-term <term>` — definition of one glossary term
- `list-glossary-terms` — list all glossary terms
- `search-glossary <query>` — search glossary definitions

**Enhanced**
- `whats-new-in-wcag22` — summary of changes introduced in WCAG 2.2
- `get-full-criterion-context <id>` — criterion + its techniques + failures + related terms in one call
- `get-server-info` — CLI/dataset version info

## Arg convention

Required arguments are positional; optional modifiers are `--flags`. Run `wcag <command> --help` for a command's exact parameters.

## Examples

```bash
wcag get-criterion 1.1.1
wcag search-wcag "keyboard"
wcag get-techniques-for-criterion 2.4.7
wcag get-criteria-by-level AA --include_lower
wcag get-failures-for-criterion 1.4.3
wcag whats-new-in-wcag22
```

## When NOT to use

If the `mcp__…_wcag__*` tools are already active in-session (e.g. the WCAG MCP server is loaded), use those directly instead — same underlying data, no subprocess needed.
