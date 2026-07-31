---
name: wcag-guidelines
description: Use whenever accessibility (a11y) or WCAG comes up — building, reviewing, remediating, or auditing UI/markup for accessibility, or answering any WCAG 2.2 / WCAG 2.1 question — even when the user does not name WCAG explicitly. Covers success criteria (e.g. 1.1.1, 1.4.3, 2.4.7, 2.5.8), conformance levels A/AA/AAA, sufficient techniques and common failures, the WCAG glossary, and what changed in WCAG 2.2. Reach for it for color/contrast ratios, alt text, ARIA roles/states/attributes, accessible names, roles and labels, keyboard navigation and focus order, focus visible, form labels and errors, headings and landmarks, live regions, screen-reader behavior, semantic HTML, target/touch size, reflow, motion, and Section 508 / EN 301 549 / ADA conformance mapping — before writing, fixing, or citing accessibility requirements. Resolves via `npx @rawwee/wcag-cli <command>` (or global `wcag`).
---

# wcag-guidelines — WCAG 2.2 Lookup CLI

`@rawwee/wcag-cli` is a standalone CLI over the full WCAG 2.2 dataset — principles → guidelines → success criteria → techniques → glossary, including the Understanding text. Invoke via `npx @rawwee/wcag-cli <command>` (or the global `wcag <command>` if installed globally). Output is markdown, and it costs 0 context tokens until you actually call it.

This is the WCAG lookup path in this setup — use it instead of recalling criterion text from memory.

## When to use

- You are about to write or review UI/markup and need to check what a success criterion actually requires
- You need to cite the correct conformance level (A/AA/AAA) for a criterion
- You need known techniques or common failures for a criterion
- You need a WCAG glossary term defined precisely
- You need to know what's new/changed in WCAG 2.2 vs 2.1

## Commands

Every command is prefixed (`get-*`, `list-*`, `search-*`). There is no bare
`criterion` / `guideline` / `search` — calling one exits 1 with `unknown command`.

**Core**
- `list-principles` — list the 4 WCAG principles (POUR)
- `list-guidelines` — list all guidelines, optionally filtered by principle (1-4)
- `list-success-criteria` — list criteria, optionally filtered by level (A/AA/AAA), guideline (e.g. `1.1`) or principle (1-4)
- `get-criterion <id>` — **the long one**: the requirement, its exceptions, and the full Understanding documentation (intent, benefits, examples). Use when you need rationale.
- `get-criterion <id> --normative` — **normative text only**: the requirement plus its exceptions, no Understanding prose. Use this when citing what a criterion actually demands. `get-success-criteria-detail <id>` is an equivalent alias, kept so older scripts keep working.
- `get-guideline <id>` — get one guideline by number
- `search-wcag <query>` — search criterion numbers, names and descriptions
- `search-wcag <query> --understanding` — also search the Understanding prose (In Brief, Intent, Benefits, Examples) and report which section matched. Reach for this when a term is practical rather than normative: "placeholder" appears in no criterion name but is discussed in three Intents.
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
- `get-full-criterion-context <id>` — criterion overview, In Brief, exceptions, sufficient/advisory/failure technique **names**, and related glossary terms in one call. The best single call when starting work on a criterion.
- `get-server-info` — CLI version plus dataset provenance: source URL, ETag, when it was fetched, cache path, TTL, and counts

## Arg convention

Required arguments are positional; optional modifiers are `--flags`. Run `wcag <command> --help` for a command's exact parameters.

## Examples

```bash
wcag get-criterion 1.1.1                      # requirement + Understanding
wcag get-criterion 1.4.3 --normative          # just what it demands
wcag get-full-criterion-context 2.5.8         # criterion + techniques + terms
wcag search-wcag "keyboard"
wcag search-wcag "placeholder" --understanding # prose, not just names
wcag get-techniques-for-criterion 2.4.7
wcag get-criteria-by-level AA --include_lower
wcag get-glossary-term contrast ratio         # multi-word, no quotes needed
wcag whats-new-in-wcag22
```

## How search matches

Lexical, not semantic — it has no idea what words mean, so **you** supply the
synonyms. What it does handle:

- Word set, any order: `focus keyboard` == `keyboard focus`
- Light stemming: `placeholders` finds `placeholder`
- Prefix: `keyb` finds `keyboard`
- Spelling/compound folding: `colour`==`color`, `screenreader`==`screen reader`
- Criterion numbers: `search-wcag 1.4.3` finds it, `search-wcag 2.4` finds all
  thirteen criteria under that guideline
- Results are relevance-ranked, so the top hits are the ones to read

If a query returns nothing, try a different word rather than concluding WCAG is
silent on the topic — and try `--understanding` before giving up.

## Freshness and offline

A complete dataset ships inside the package, so **every command works with no
network and no cache** — there is no first-run download. It refreshes itself from
w3.org at most weekly via a conditional request, and a failed refresh falls back
to cache then to the bundled copy rather than erroring.

- `--refresh` forces a refresh now (valid before or after the command)
- `WCAG_CLI_NO_NETWORK=1` guarantees zero requests — use it in CI or when egress
  matters

`--normative` and `--understanding` need **>= 0.2.0**; `npx` may hold an older
cached copy, so check `get-server-info` if a flag is rejected.

## When NOT to use

- **Auditing a live page** — this is a reference dataset, not a scanner. To find actual violations in a running UI, drive the page (Chrome DevTools / Lighthouse) and use this CLI only to look up what the failing criterion requires.
- **Reading the repo's own a11y conventions** — check the repo's docs/standards first; this CLI is the upstream spec, not local policy.

If the CLI is genuinely unavailable (no npx, install refused), say so and fall
back to your own WCAG knowledge — but flag that the criterion text is unverified
rather than quoting it as exact. Being offline is *not* such a case: the bundled
dataset answers every command without a network.

## Reading the exit code

A wrong command exits 1, but **a valid command with a bad argument exits 0** and
prints a plain-language miss:

```
$ wcag get-criterion 9.9.9        # exit 0
No success criterion found with number "9.9.9". Use format like "1.1.1" or "2.4.7".

$ wcag search-wcag "zzzznotathing"  # exit 0
No success criteria found matching "zzzznotathing". Try --understanding to search the Intent, Benefits and Examples prose as well.
```

So never treat exit 0 as "the lookup worked" — read the output. And never pipe
through `head` while checking `$?`, since that reports the exit code of `head`,
not of `wcag`.
