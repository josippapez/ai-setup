---
name: accessibility
description: 'Use whenever accessibility or a11y work comes up, and for any WCAG question — even when WCAG is never named. Looks up authoritative WCAG 2.2 / 2.1 text with the bundled wcag CLI (`npx @rawwee/wcag-cli`) instead of recalling it from memory: success criteria, conformance levels A/AA/AAA, techniques, common failures, glossary terms. Load it before writing, reviewing, fixing, or citing anything accessibility-related.'
when_to_use: 'Any accessibility or a11y work, even when WCAG is never named: contrast ratios, alt text, ARIA roles/states/attributes, accessible names, labels, keyboard navigation, focus order, focus visible, form errors, headings, landmarks, live regions, screen readers, semantic HTML, target/touch size, reflow, motion, Section 508 / EN 301 549 / ADA mapping. Direct asks: "wcag cli", "check the wcag", "run wcag", "a11y check", "accessibility audit", "accessibility review", "is this accessible", any criterion number (1.1.1, 1.4.3, 2.4.7, 2.5.8), "what changed in WCAG 2.2". Never guess criterion text, levels, or CLI flags. Not for scanning a live page (drive the browser) or for the repo own a11y conventions.'
---

# accessibility — WCAG 2.2 lookup, via the wcag CLI

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
- `get-criteria-by-level <level>` — list criteria at a conformance level (A/AA/AAA); `--include_lower` rolls in the levels below it (AA then also returns A)
- `count-criteria <group_by>` — counts, grouped by `level`, `principle` or `guideline`. The grouping is required, not optional: bare `count-criteria` exits 1.

**Techniques**
- `list-techniques` — list all 422 techniques; `--technology html|aria|css|pdf|general|client-side-script|server-side-script|smil|text|failures` and `--type sufficient|advisory|failure` narrow it
- `get-technique <id>` — get one technique by id
- `get-techniques-for-criterion <id>` — techniques mapped to a success criterion
- `search-techniques <query>` — matches technique **titles only**. The dataset holds each technique's id, technology, title, types and mapped criteria — not its prose — so a word that only appears in the body of a technique page will not be found here. For the full text of a technique, follow the w3.org link; to see everything attached to a criterion, use `get-techniques-for-criterion`.
- `get-failures-for-criterion <id>` — known failure techniques for a criterion

**Glossary**
- `get-glossary-term <term>` — definition of one glossary term
- `list-glossary-terms` — list all glossary terms
- `search-glossary <query>` — search glossary definitions

**Enhanced**
- `whats-new-in-wcag22` — summary of changes introduced in WCAG 2.2
- `get-full-criterion-context <id>` — criterion overview, In Brief, exceptions, sufficient/advisory/failure technique **names**, and related glossary terms in one call. The best single call when starting work on a criterion.
- `get-server-info` — CLI version plus dataset provenance: source URL, ETag, when it was fetched, cache path, TTL, and counts

## Pick the smallest command that answers the question

Output goes straight into context, and the commands differ by ~40x. Measured on
1.4.3 (bigger criteria run larger):

| Need | Command | ~tokens |
|---|---|---|
| What does it demand? (cite this) | `get-criterion <id> --normative` | 250 |
| Known failures to check for | `get-failures-for-criterion <id>` | 110 |
| Which criteria at this level | `list-success-criteria --level AA` | 440 |
| How to satisfy it | `get-techniques-for-criterion <id>` | 390 |
| Starting work on a criterion | `get-full-criterion-context <id>` | 800–2000 |
| Why it exists / edge cases | `get-criterion <id>` | **~3900** |
| Everything, unfiltered | `list-techniques` | **~9800** |

Default to `--normative`. Reach for the full `get-criterion` only when you
actually need rationale or worked examples, and filter `list-techniques` with
`--technology` / `--type` rather than dumping all 422.

## Arg convention

Required arguments are positional; optional modifiers are `--flags`. Run `wcag <command> --help` for a command's exact parameters.

Flag order and position do not matter: `get-criterion --normative 1.4.3` and
`get-criterion 1.4.3 --normative` are the same call, and a flag written between
the words of a multi-word value is put back where you typed it, so
`search-wcag contrast --understanding ratio` searches `contrast ratio`.

The one thing that does not work is a value starting with `--` — it is read as a
flag. The CLI now names the token when that happens (`--foo was read as a flag,
not a value`) instead of only reporting the missing argument. A single leading
dash is fine: `search-wcag -webkit` searches for `-webkit`.

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
- Hyphenated terms stay whole: `aria-labelledby` is one token, not two
- Results are relevance-ranked, so the top hits are the ones to read

If a query returns nothing, try a different word rather than concluding WCAG is
silent on the topic — and try `--understanding` before giving up.

## WCAG 2.1 questions

The dataset is 2.2, which is a superset: every criterion prints a
`**WCAG Versions:**` line, so you can answer 2.1 questions from it directly.
Of the 87 criteria, 61 are in 2.0, 78 in 2.1, 86 in 2.2.

- The 9 added in 2.2: 2.4.11, 2.4.12, 2.4.13, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8, 3.3.9
- **4.1.1 Parsing** is still in the dataset but prints `Level: Removed in WCAG 2.2`
  and `WCAG Versions: 2.0, 2.1`. It applies to a 2.1 target and not a 2.2 one — do
  not cite it as a live requirement without saying which version is in scope.

## Citing a criterion

`get-criterion <id> --normative` is the citation unit: it gives the level, its
principle and guideline, the versions it belongs to, the requirement, its
exceptions, and three canonical links (the spec section, its Understanding page,
and How to Meet). Quote the requirement text as printed rather than paraphrasing,
and give the level alongside it — "1.4.3 (AA)" — since the level is what decides
whether it is in scope for a given conformance target.

## Freshness and offline

A complete dataset ships inside the package, so **every command works with no
network and no cache**, and a network problem never turns a lookup into an error.

The data you get back is kept current, not just bundled. The first command on a
new install refreshes **before it answers, in the same call**: one conditional
request for `wcag.json` (the bundle ships with its own ETag, so this is normally a
`304` with an empty body), written to `$XDG_CACHE_HOME/wcag-cli` (or
`~/.cache/wcag-cli`), so freshness runs from your first use rather than from the
package's publish date. After that the cache is reused for a week. Understanding
and technique pages are fetched the first time you read each one and cached per
page, so `get-criterion` and `get-technique` return the page as W3C publishes it
today. Every request is bounded by a 5 s timeout; a refresh that cannot complete
prints a note to stderr and answers from cache, then bundle.

- `--refresh` forces a refresh now (valid before or after the command)
- `WCAG_CLI_NO_NETWORK=1` guarantees zero requests — use it in CI or when egress
  matters. It **wins over `--refresh`**, so a run with both is offline and
  reproducible.

`--normative` and `--understanding` need **>= 0.2.0**; `npx` may hold an older
cached copy, so check `get-server-info` if a flag is rejected.

## When NOT to use

- **Auditing a live page** — this is a reference dataset, not a scanner. To find actual violations in a running UI, drive the page (Chrome DevTools / Lighthouse) and use this CLI only to look up what the failing criterion requires.
- **Reading the repo's own a11y conventions** — check the repo's docs/standards first; this CLI is the upstream spec, not local policy.
- **Section 508 / EN 301 549 / ADA mapping** — the dataset has no such mapping and no command emits one. Both standards incorporate WCAG Level AA by reference, so look up the AA criteria here (`list-success-criteria --level AA`, then `--normative` for each) and be explicit that the legal mapping itself came from you, not from the dataset.

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
