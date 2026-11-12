# find_docs ranking eval

Runs the real `rankDocs` (runtime/lib/doc-search.cjs, the code find_docs calls) against this repo's own index, with rerank on and with `rerank:false`.

```bash
node claude/plugins/repo-docs/evals/ranking/run.cjs [--json out.json]
```

Needs `.claude/repo-docs/` built (`/repo-docs:reindex`) and a node_modules holding `@huggingface/transformers` and `@orama/orama`: it looks in `$REPO_DOCS_NODE_MODULES`, then `plugins/data/repo-docs-ai-setup/node_modules` under `$CLAUDE_CONFIG_DIR`, `~/.claude-work` and `~/.claude`. About 2 minutes.

- `questions.json`: 34 labelled questions `{id, q, expected: [paths]}`; a hit is any expected path in the top 12 files. Labels point at docs that exist today; when docs move, fix the paths here.
- `offtopic.json`: 15 queries no doc answers (10 unrelated, 5 technical near-misses). Pick queries that really are uncovered: "react useEffect cleanup" was dropped because gsap-react's SKILL.md covers it.
- Prints hit@1, hit@3, MRR, how many off-topic queries still return files, and per query the candidate no-match signals (best dense cosine, top Orama hybrid score, top cross-encoder logit).

## Numbers (2,407 chunks, 2026-11-12)

| | hit@1 | hit@3 | MRR | off-topic returning files |
|---|---|---|---|---|
| rerank on, before no-match cutoff | 26/34 | 27/34 | 0.800 | 15/15 |
| rerank on, with cutoff (-1.4 logit) | 26/34 | 27/34 | 0.800 | 0/15 |
| rerank off | 25/34 | 26/34 | 0.776 | 15/15 |
| rerank off, int8 index | 25/34 | 27/34 | 0.784 | 15/15 |

Signal separation (lowest on-topic question that finds its doc vs highest off-topic): cross-encoder logit -1.31 vs -1.53 (margin 0.22, thin: 15 off-topic queries); best cosine 0.62 vs 0.63 and hybrid score 0.82 vs 0.96 do not separate. So only the rerank path has a cutoff.
