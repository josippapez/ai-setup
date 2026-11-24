---
name: accessibility
description: 'Use whenever accessibility or a11y work comes up, and for any WCAG question — even when WCAG is never named. Two halves: scan a running page for real violations with the bundled axe-core harness driven through the browse MCP, and look up authoritative WCAG 2.2 / 2.1 text with the bundled wcag CLI (`npx @rawwee/wcag-cli@latest`) instead of recalling it from memory. Load it before writing, reviewing, fixing, auditing, or citing anything accessibility-related.'
when_to_use: 'Any accessibility or a11y work, even when WCAG is never named: contrast ratios, alt text, ARIA roles/states/attributes, accessible names, labels, keyboard navigation, focus order, focus visible, form errors, headings, landmarks, live regions, screen readers, semantic HTML, target/touch size, reflow, motion, Section 508 / EN 301 549 / ADA mapping. Direct asks: "accessibility audit", "accessibility review", "a11y check", "run axe", "is this accessible", "check the focus indicators", "keyboard walk", "wcag cli", "check the wcag", any criterion number (1.1.1, 1.4.3, 2.4.7, 2.5.8), "what changed in WCAG 2.2". Never guess criterion text, levels, or CLI flags. A repo with its own accessibility policy, skill, or PR gate outranks this one — follow that instead.'
---

# accessibility — scan the page, look up the criterion

`@rawwee/wcag-cli` is a standalone CLI over the full WCAG 2.2 dataset — principles → guidelines → success criteria → techniques → glossary, including the Understanding text, each technique's full page, the ACT test rules, the conformance requirements and the errata. `--wcag 2.1` switches to another version. Invoke via `npx @rawwee/wcag-cli@latest <command>` (or the global `wcag <command>` if installed globally). Output is markdown, and it costs 0 context tokens until you actually call it.

This is the WCAG lookup path in this setup — use it instead of recalling criterion text from memory. Finding real violations in a running page is the other half: see [Scanning a live page](#scanning-a-live-page).

**A repo with its own accessibility policy, skill, or PR gate outranks this file.** Follow that one; this is the fallback for repos that have none.

## When to use

- You need to find actual violations in a running page — see [Scanning a live page](#scanning-a-live-page)
- You are about to write or review UI/markup and need to check what a success criterion actually requires
- You need to cite the correct conformance level (A/AA/AAA) for a criterion
- You need known techniques or common failures for a criterion
- You need a technique's test procedure, or the ACT test rules for a criterion
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
- `search-wcag <query> --understanding` — also search the Understanding prose (In Brief, Intent, Benefits, Examples) and report which section matched. Reach for this when a term is practical rather than normative, like `placeholder`.
- `get-criteria-by-level <level>` — list criteria at a conformance level (A/AA/AAA); `--include_lower` rolls in the levels below it (AA then also returns A)
- `count-criteria <group_by>` — counts, grouped by `level`, `principle` or `guideline`. The grouping is required, not optional: bare `count-criteria` exits 1.

**Techniques**
- `list-techniques` — list every published technique; `--technology html|aria|css|pdf|general|client-side-script|server-side-script|smil|text|failures` and `--type sufficient|advisory|failure` narrow it
- `get-technique <id>` — the technique page: what it applies to, description, examples with code, the test procedure and expected results, related techniques and resources
- `get-technique <id> --brief` — the same without examples and resources. Examples are the part that gets large, so use this when you need the procedure, not the samples.
- Retired techniques (F70, the FLASH and SL pages, ...) still answer `get-technique`, with an **Obsolete** notice; they are not in `list-techniques`.
- `get-techniques-for-criterion <id>` — techniques mapped to a success criterion
- `search-techniques <query>` — matches technique titles; `--description` also searches each technique's description, examples and tests, and reports which section matched
- `get-failures-for-criterion <id>` — known failure techniques for a criterion
- `get-techniques-for-element <name>` — the techniques and failures about an HTML element or attribute (`img`, `<input>`, `alt`, `aria-describedby`), the criteria they serve, and the techniques whose code examples use it. Start here when you know the markup but not the criterion.

**Glossary**
- `get-glossary-term <term>` — definition of one glossary term
- `list-glossary-terms` — list all glossary terms
- `search-glossary <query>` — search glossary definitions

**Test rules, conformance, errata**
- `get-test-rules-for-criterion <id>` — the W3C-approved ACT test rules for a criterion, with a link to each; rules awaiting approval are marked (proposed)
- `get-test-cases <id>` — the ACT rules' HTML examples for a criterion, or for one ACT rule id (`23a2a8`): markup that passes, fails, or is out of scope. `--expected failed` keeps only the failing markup. Large for 1.3.1 and 4.1.2, so filter it.
- `get-conformance-requirements` — the conformance requirements from the Recommendation
- `list-input-purposes [keyword]` — the autocomplete tokens that 1.3.5 Identify Input Purpose relies on, optionally filtered
- `list-errata` — published errata, newest first, each with the pull request behind it
- `list-changes [--since YYYY-MM-DD]` — which Understanding and technique pages W3C changed in each publish, and which sections (intent, examples, resources, ...)

**Enhanced**
- `whats-new` — the criteria the selected version added and removed (`whats-new-in-wcag22` is an alias)
- `get-full-criterion-context <id>` — criterion overview, In Brief, exceptions, sufficient/advisory/failure technique **names**, related glossary terms and test rules in one call. The best single call when starting work on a criterion.
- `get-server-info` — CLI version, the WCAG version in use, and dataset provenance: source URL, ETag, when it was fetched, cache path, TTL, and counts

**Global flags**
- `--json` — the structured data behind the answer instead of Markdown, for when you need to filter or count results
- `--wcag <version>` — answer for another WCAG version, e.g. `--wcag 2.1`. The first run for a version fetches it from w3.org and caches it. `WCAG_CLI_VERSION=2.1` sets the default.

## Pick the smallest command that answers the question

Output goes straight into context, and the commands differ in size by orders of
magnitude. Smallest first:

| Need | Command |
|---|---|
| How to test it automatically | `get-test-rules-for-criterion <id>` |
| Known failures to check for | `get-failures-for-criterion <id>` |
| Which techniques cover this markup | `get-techniques-for-element <name>` |
| Real markup that fails a rule | `get-test-cases <id> --expected failed` |
| What does it demand? (cite this) | `get-criterion <id> --normative` |
| How to satisfy it | `get-techniques-for-criterion <id>` |
| Which criteria at this level | `list-success-criteria --level AA` |
| Starting work on a criterion | `get-full-criterion-context <id>` |
| How to apply and test a technique | `get-technique <id> --brief` |
| The technique with its code samples | `get-technique <id>` |
| Why it exists / edge cases | `get-criterion <id>` (**large**) |
| Everything, unfiltered | `list-techniques` (**largest**) |

Default to `--normative`. Reach for the full `get-criterion` only when you
actually need rationale or worked examples, and filter `list-techniques` with
`--technology` / `--type` rather than dumping the whole list.

## Arg convention

Required arguments are positional; optional modifiers are `--flags`. Run `wcag <command> --help` for a command's exact parameters.

Flag order and position do not matter: `get-criterion --normative 1.4.3` and
`get-criterion 1.4.3 --normative` are the same call, and a flag written between
the words of a multi-word value is put back where you typed it, so
`search-wcag contrast --understanding ratio` searches `contrast ratio`.

The one thing that does not work is a value starting with `--` — it is read as a
flag, and the CLI names the token when that happens (`--foo was read as a flag,
not a value`). A single leading dash is fine: `search-wcag -webkit` searches for
`-webkit`.

## Examples

```bash
wcag get-criterion 1.1.1                      # requirement + Understanding
wcag get-criterion 1.4.3 --normative          # just what it demands
wcag get-full-criterion-context 2.5.8         # criterion + techniques + terms
wcag search-wcag "keyboard"
wcag search-wcag "placeholder" --understanding # prose, not just names
wcag get-techniques-for-criterion 2.4.7
wcag get-technique H37 --brief                # description + test procedure
wcag search-techniques "newsletter" --description # technique bodies, not just titles
wcag get-test-rules-for-criterion 1.1.1
wcag get-test-cases 1.1.1 --expected failed    # failing ACT example markup
wcag get-techniques-for-element "<img>"       # techniques for the markup you have
wcag list-changes --since 2026-10-01          # what W3C changed recently
wcag get-criteria-by-level AA --include_lower
wcag get-glossary-term contrast ratio         # multi-word, no quotes needed
wcag whats-new
wcag --wcag 2.1 get-criterion 4.1.1 --normative # another version
wcag search-wcag keyboard --json              # structured output
```

## How search matches

Lexical, not semantic — it has no idea what words mean, so **you** supply the
synonyms. What it does handle:

- Word set, any order: `focus keyboard` == `keyboard focus`
- Light stemming: `placeholders` finds `placeholder`
- Prefix: `keyb` finds `keyboard`
- Spelling/compound folding: `colour`==`color`, `screenreader`==`screen reader`
- Criterion numbers: `search-wcag 1.4.3` finds it, `search-wcag 2.4` finds every
  criterion under that guideline
- Hyphenated terms stay whole: `aria-labelledby` is one token, not two
- Results are relevance-ranked, so the top hits are the ones to read

If a query returns nothing, try a different word rather than concluding WCAG is
silent on the topic — and try `--understanding` (criteria) or `--description`
(techniques) before giving up.

## WCAG 2.1 questions

When the target is 2.1, pass `--wcag 2.1`: the answer comes from the 2.1 dataset
itself, with its own levels, Understanding pages and techniques. For a quick check
the default 2.2 dataset also works, since every criterion prints a
`**WCAG Versions:**` line. `whats-new` lists what a version added and removed.

**4.1.1 Parsing** shows why the version matters: the 2.2 dataset prints
`Level: Removed in WCAG 2.2`, while `--wcag 2.1` prints it as Level A. It applies
to a 2.1 target and not a 2.2 one, so do not cite it as a live requirement without
saying which version is in scope.

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

Only WCAG 2.2 is bundled. The first `--wcag` run for another version needs the
network, and says so if it has none.

`--normative` and `--understanding` need **>= 0.2.0**. Technique pages,
`--description`, test rules, conformance, input purposes, errata, `--json` and
`--wcag` need **>= 0.4.0**, and `--brief` needs **>= 0.5.0**. `npx` may hold an
older cached copy, so check `get-server-info` if a command or flag is rejected.

## Scanning a live page

The CLI cannot find a violation. `scripts/a11y-audit.js`, beside this file, can: it runs axe-core
over the page and adds a tab-order, accessible-name and focus-indicator probe. It works against any
web app with no per-repo setup. Driven through the browse MCP, in the user's own Chrome.

Two entry points, and only the second is trusted for focus indicators:

- `window.__a11yAudit()` — screening pass: axe violations, tab order, accessible names, landmarks,
  headings, plus a programmatic focus probe. That probe **over-reports**, calling controls
  unindicated that do paint under real keyboard focus.
- `window.__a11yWalkStart()` / `window.__a11yWalkRead()` — the real-keyboard walk, and the oracle.
  Never report a "no focus indicator" finding from the screening pass alone.

Every browse `eval` here needs `world: "main"`. The default isolated world sees the DOM but not
`window.__a11yAudit`.

### The loop

1. **Open the page** with browse `navigate` and keep the `tab` id it returns. If browse is not
   connected, ask the user to run `npx -y @opencode/browse@latest install --agent none` once.

2. **Inject axe and the harness from Bash**, with the `browse` CLI, so neither file's source passes
   through your context:

   ```bash
   SKILL=$(ls -dt ~/.claude/plugins/cache/*/dev-core/*/skills/accessibility \
                  ~/.config/opencode/skills/accessibility 2>/dev/null | head -1)
   AXE=$(ls -t ~/.claude/plugins/data/dev-core-*/node_modules/axe-core/axe.min.js 2>/dev/null | head -1)
   TAB=<the tab id navigate returned>
   inject() {
     browse eval --json "$(jq -nc --arg tab "$TAB" --rawfile src "$1" --arg check "$2" \
       '{tab: ($tab | tonumber? // $tab), world: "main", timeout: 120000, expression: ($src + "\n;" + $check)}')"
   }
   [ -n "$AXE" ] && inject "$AXE" 'window.axe.version'            # prints "4.13.0"
   inject "$SKILL/scripts/a11y-audit.js" 'typeof window.__a11yAudit'  # prints "function"
   ```

   Do not inject with a `<script src="http://127.0.0.1:...">` tag. Chrome holds a public `https://`
   page's request to this machine until the user answers a local network permission prompt, so
   that load hangs on every site except localhost. The eval route also works under a strict content
   security policy (measured on GitHub).

   An empty `$AXE` means the plugin's install hook has not run in this session yet. Skip that
   line: the harness then loads the same pinned version from jsDelivr, which needs the network and
   can be blocked by a strict content security policy.

3. **Screen** with `eval` (`world: "main"`, `timeout: 180000`; the default 30 s is too short):
   `await window.__a11yAudit()`, returning only the fields you need. Results over 100k characters
   are cut. Measured: 38 s on a 194-control page.

4. **Confirm every negative focus finding** with the walk: `eval` `window.__a11yWalkStart()`, then
   one `press` call with key `Tab` per control, then `eval` `window.__a11yWalkRead()`. Leave at least
   half a second between Tabs and before the read, and never use `press`'s `count`. Each step is read
   350 ms after focus lands, so a control the next Tab has already left reads as `NONE` (measured:
   back-to-back Tabs flagged a button that has a visible ring).

5. **Look up** what each violation's criterion actually demands with the CLI above, then report.

### Where axe comes from

The plugin's own pinned copy (`axe-core` in the plugin `package.json`, installed into the plugin
data dir by a SessionStart hook), injected in step 2. No network needed. Without it, the harness
loads the same version from jsDelivr.

`axeVersion` is what actually ran. Check it against the pin: `axeFrom` reads "already on the page"
after step 2, because the harness reuses any `window.axe` it finds, and a browser extension can put
one there too.

Two knobs, both set with an `eval` (`world: "main"`) before the harness is injected:

- `window.__A11Y_AXE_URL` — force a specific axe URL, skipping both defaults. Only matters when
  step 2's axe line is skipped.
- `window.__A11Y_IGNORE` — CSS selector for chrome that is not the product under audit. Defaults to
  the TanStack Router/Query devtools overlays.

### What it cannot do

- **Log in.** browse runs in the user's own Chrome, so their sessions are usually there already.
  When a page still needs a login, hand the tab over with browse `handoff` and carry on once they
  click Continue. Do not script around the login.
- **Hear anything.** It reads computed styles and the DOM, not announcements. Screen-reader output
  needs a real or virtual reader.
- **Decide.** axe finds a fraction of WCAG failures, and some of what it reports is not a product
  bug. Read `incomplete` as "look at this", not as a violation.

## When NOT to use

- **Finding violations in a running UI** — the CLI is a reference dataset, not a scanner. Use the harness in [Scanning a live page](#scanning-a-live-page), then the CLI to look up what each failing criterion requires.
- **Reading the repo's own a11y conventions** — check the repo's docs/standards first; this CLI is the upstream spec, not local policy.
- **Section 508 / EN 301 549 / ADA mapping** — the dataset has no such mapping and no command emits one. Both standards incorporate WCAG Level AA by reference, so look up the AA criteria here (`list-success-criteria --level AA`, then `--normative` for each) and be explicit that the legal mapping itself came from you, not from the dataset.

If the CLI is genuinely unavailable (no npx, install refused), say so and fall
back to your own WCAG knowledge — but flag that the criterion text is unverified
rather than quoting it as exact. Being offline is *not* such a case: the bundled
2.2 dataset answers every command without a network.

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
