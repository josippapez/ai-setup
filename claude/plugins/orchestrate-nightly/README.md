# Orchestration Claude Plugin (nightly)

Experimental fork of `orchestrate`. Same git-ignored `.orchestration/` store, same intake, explore, refine, design, plan, and converge phases. Different execution layer. Engages only when asked for by name (`/orchestrate-nightly`, or "nightly" in the request), so the stable plugin keeps owning the generic triggers.

Goal per epic, against the stable workflow on comparable work: less wall-clock and no more tokens.

Requires the stable `orchestrate` plugin to stay installed. Nightly reuses its repo-docs MCP tools and its grilling, grill-with-docs, domain-modeling, and wcag-guidelines skills, and registers no MCP server of its own.

## What changed

| | stable | nightly |
|---|---|---|
| Worker | builds, then spawns 3 to 5 gate subagents, joins them, retries | builds, runs supplied quality commands and test suite itself, returns |
| Review | per chunk: md-reviewer + code-standards-checker + implementation-quality-reviewer (+ quality-gates-checker, regression-checker) | one `batch-reviewer` per two finished chunks, or per wave tail, with all three checklists; risk-tagged chunks reviewed solo |
| Fix rounds | original worker re-fixes and re-spawns gates | `md-fixer` (haiku for mechanical fix-lists, sonnet otherwise), then the next batch |
| Build model | low haiku, medium sonnet, high opus, max fable | low haiku, medium sonnet, high sonnet, high with `risk` tag opus, max opus |
| Reviewer model | sonnet, opus for high | sonnet, opus only when a chunk in the batch has a risk tag |
| Chunking | cohesive, independently reviewable | fewer and larger: 2 to 4 per epic, merge same-file chunks, fold sub-30-line chunks |
| Nested spawning | required (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2`) | none |
| Status writer | worker per chunk | orchestrator only |

## Why these changes (measured)

Numbers from 97 orchestration subagents in local transcripts, September 2026, priced at first-party API rates (see `bench/orchestration-cost.cjs` for the price table):

| Role | model | n | avg cost | avg minutes |
|---|---|---|---|---|
| md-worker | opus | 8 | $40.07 | 65 |
| md-worker | sonnet | 14 | $6.16 | 25 |
| md-reviewer | opus | 5 | $7.35 | 14 |
| md-reviewer | sonnet | 14 | $0.89 | 4 |
| implementation-quality-reviewer | sonnet | 2 | $1.17 | 5 |
| code-standards-checker | sonnet | 10 | $0.73 | 3 |
| regression-checker | sonnet | 8 | $0.28 | 2 |
| quality-gates-checker | haiku | 7 | $0.07 | 0.4 |

Per chunk, the gates cost about a third of a sonnet worker and sat on the critical path after each build, plus a fix round that re-spawned them. The three judgement gates each load the spec, diff, and repo separately. Two of the five gates are command runners whose whole job the worker can do in place.

Modelled 6-chunk epic (4 medium, 2 high untagged), gates fully applicable, no fix rounds:

| | cost | agent-minutes |
|---|---|---|
| stable | $143 | ~330 |
| nightly, builders same tiers as stable | $109 | ~280 |
| nightly, high untagged on sonnet | ~$41 | ~180 |

The batch-reviewer cost is an estimate (1.6x one sonnet md-reviewer per two chunks). Everything else in the model is a measured average. Wall-clock gains come from three places: review overlaps the next build instead of following it, no nested spawn and join inside the worker, and sonnet instead of opus for untagged `high` chunks. Whether a sonnet builder plus a batch review matches opus quality on those chunks is the open question the nightly run exists to answer.

## Measuring

```bash
node claude/plugins/orchestrate-nightly/bench/orchestration-cost.cjs --since 2026-09-01
```

Prints tokens, estimated cost, minutes, and turns per role, grouped by plugin namespace, and a per-plugin total. Compare a nightly epic with a stable epic of similar size. The close-out brief must include these numbers.

## Layout

- `skills/orchestrate-nightly/` — dispatcher, `references/` (`routing`, `store-protocol`, `intake-design`, `execution`, `platform`, `close-out-brief`), `templates/`.
- `agents/` — `md-builder`, `batch-reviewer`, `md-fixer`, plus unchanged copies of `repo-scout`, `solution-reuse-scout`, `impl-planner`, `council-member`, `design-lead`, `docs-maintainer`, `test-specialist`, `wcag-reviewer`, and the contract test.
- `commands/orchestrate-nightly.md`.
- `bench/orchestration-cost.cjs` and its test.

## Tests

```bash
node --test claude/plugins/orchestrate-nightly/agents/agent-contracts.test.cjs claude/plugins/orchestrate-nightly/bench/orchestration-cost.test.cjs
claude plugin validate claude/plugins/orchestrate-nightly
```
