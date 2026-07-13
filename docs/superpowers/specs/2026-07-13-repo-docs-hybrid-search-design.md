# Repo-docs hybrid search rework — design

- **Date:** 2026-07-13
- **Status:** Design approved; models locked by benchmark (§9). Ready for implementation plan.
- **Owner:** interactive-mcp + markdown-orchestration plugins (repo-docs semantic search)

## 1. Goal

Make `find_docs` materially more precise by replacing the current
one-embedding-per-file semantic layer with a **chunked, hybrid
(keyword + dense), reranked** retrieval pipeline — while preserving the plugin's
**zero-setup, no-native-binary, fully-local, private** properties.

## 2. Motivation (problems with today's design)

- **One vector per whole file.** A 29 KB multi-topic doc collapses to a single
  point, blurring distinct sections. Benchmarks show chunking is the single
  biggest quality lever.
- **Truncation.** Whole-doc embedding is capped at `MAX_CHARS_PER_DOC = 2000`
  and the model's token window; ~50% of this repo's docs exceed the cap and lose
  their tail. Chunking removes truncation entirely (each chunk ≤ ~400 tokens).
- **Weak lexical signal.** Dense cosine misses exact tokens (flags, symbols,
  acronyms). The current keyword+semantic fusion is a crude additive hack
  (`find-docs.cjs:149-172`), not a principled hybrid.
- **No reranking.** The highest-ROI precision step in RAG is absent.

## 3. Scope

**In scope**
- Markdown docs only (`*.md`/`*.mdx`, excluding vendor/build dirs — unchanged
  corpus definition via `getDocFiles`).
- Both plugin copies (`interactive-mcp` and `markdown-orchestration`) reworked in
  **lockstep** — they ship byte-identical `semantic-index.cjs` and the same
  repo-docs tools, and write the same on-disk store.
- CPU/ONNX engine (transformers.js), preserving zero-setup.

**Non-goals (explicitly deferred)**
- **Code indexing.** Code navigation stays with the structural tools
  (`get_blast_radius`, `get_file_dependencies`/`dependents`) + grep/LSP. General
  embedding models are weak on code and would add noise; this is a separate,
  structural track if ever pursued.
- **Metal / node-llama-cpp engine.** ONNX is CPU-only in Node on macOS; Metal
  would require moving off transformers.js. Unnecessary at ~2k chunks (CPU is
  instant). Revisit only if code indexing is later added.

## 4. Current state (baseline)

- `runtime/lib/semantic-index.cjs`: a worker-thread transformers.js embedder;
  one mean-pooled vector per file; JSON cache
  `.claude/repo-docs/interactive-mcp-doc-embeddings.json` keyed by path with
  `{mtime, vector}` and a `_meta {model, dtype, schemaVersion}` that
  self-invalidates on change.
- `runtime/tools/find-docs.cjs`: keyword scan (path/title/dir-context bonuses,
  length-normalized) then additive merge of semantic hits; returns a single
  compact string `docs "q"; 1) path:line snippet; ...`.
- `runtime/tools/build-semantic-index.cjs`: CLI builder used by the `reindex`
  command and warmed on MCP `initialize`.

## 5. Target architecture

Pipeline: **chunk → embed (dense) + index (BM25) → hybrid retrieve (RRF) →
[optional rerank] → return file + section + snippet.** The reranker is built but
off by default (§5.5, §9).

### 5.1 Chunker (`lib/chunker.cjs`, new)
- **Markdown-heading-aware.** Split on headings into sections; within a section,
  pack text into windows of **~400 tokens (~1500 chars)** with **~200-char
  overlap**. Each chunk carries `{path, headingPath, startLine, text}`.
- `headingPath` = breadcrumb of ancestor headings (e.g. `Execution rules ›
  Relaunch cap`) — used for the section anchor in results.
- **Whole-file coverage:** every chunk of a doc is indexed — no per-file
  truncation. The old `MAX_CHARS_PER_DOC`/token-window truncation is gone.
- **Safety cap (configurable):** skip/cap only pathological inputs — files over
  `MAX_FILE_BYTES` (~1 MB) or more than `MAX_CHUNKS_PER_FILE` (~200) — far above
  any real doc. `log()` what was skipped; never silently truncate normal docs.

### 5.2 Embedder (`lib/semantic-index.cjs`, reworked)
- Same worker-thread + dynamic-`import()` ONNX approach (proven).
- **Dense model: `bge-small-en-v1.5`** (384-dim, ~33M, ~90 MB) with the query
  prefix `"Represent this sentence for searching relevant passages: "` on
  queries only. Best-measured overall — the larger bge-base/gte-base were tested
  and performed *worse* (§9). Chunk inputs are ≤ ~400 tokens, so the 512-token
  window is never exceeded — truncation is gone.
- Embeds **chunks**, not files.

### 5.3 Index & store — Orama (`lib/doc-index.cjs`, new)
- **Orama** (`@orama/orama`, pure-JS, zero native binaries) is the single store:
  full-text **BM25** + **vector** fields over chunk records. It is both the
  search engine and the persisted cache.
- Persist with `@orama/plugin-data-persistence` to
  `.claude/repo-docs/repo-docs-index.msp` (self-ignored via the existing
  `.gitignore` writer). Keep a small sidecar `{path: mtime}` map + `_meta`
  `{model, dtype, chunker, schemaVersion}` for **incremental** updates: on build,
  re-chunk/re-embed only changed files and upsert; drop records for deleted
  files. Any `_meta` mismatch rebuilds from scratch.

### 5.4 Hybrid retrieval
- Query Orama in `hybrid` mode (BM25 + dense) → fuse with **Reciprocal Rank
  Fusion** (`RRF_K=60`). Take **top-N (~10) chunks** as rerank candidates
  (10 was the benchmarked value; tunable).

### 5.5 Reranker (`lib/reranker.cjs`, new) — built, OFF by default
- ONNX cross-encoder **`Xenova/bge-reranker-base`** via
  `AutoModelForSequenceClassification` + tokenizer `text_pair`, run in the worker.
- Score each of the top-N `(query, chunk.text)` pairs; sort by logit.
- **Off by default; opt-in two ways:** a per-call `rerank: boolean` input on the
  `find_docs` tool (default `false`) so an agent can request it on demand for an
  exact-term query, **or** a repo-wide `RERANK_ENABLED` env. Effective when
  `args.rerank === true || RERANK_ENABLED`. Evidence
  (§9) shows the cross-encoder helps *literal-overlap* queries but *hurts*
  paraphrased/natural-language queries — and `find_docs` queries (often
  agent-issued intent) skew paraphrased. Default off is the robust-correctness
  choice; enable+measure per repo (e.g. a real docs repo) with real queries.
- When enabled: graceful fallback to hybrid order if the reranker worker isn't
  ready; ~100–300 ms/query, query-time only. A future refinement is a
  non-destructive score *blend* (RRF the reranker rank with the hybrid rank)
  instead of a hard reorder, so it can't catastrophically demote.

### 5.6 Return contract (`find-docs.cjs`, reworked)
- Collapse reranked chunks to **files**, best chunk wins; return ranked
  **file + section anchor (`headingPath`) + snippet + start line**. Format stays
  a compact string, enriched:
  `docs "q"; 1) path:line › Section heading — snippet; ...`.
- `limit` default 12 (max 30), unchanged.

## 6. Data flow

**Index (build / warm / reindex):** enumerate doc files → for each changed file
(mtime): chunk → embed chunks → upsert chunk records into Orama → persist. Runs
incrementally in the background on `initialize` and via the `reindex` command.

**Query (`find_docs`):** embed query → Orama hybrid(BM25+dense)+RRF → top-N
chunks → cross-encoder rerank → collapse to files → format.

## 7. Module boundaries (keep files small, single-purpose)

- `chunker.cjs` — text → chunk records. Pure, unit-testable.
- `semantic-index.cjs` — dense embedder worker (embed one text → vector).
- `reranker.cjs` — cross-encoder worker (score (query, text) pairs).
- `doc-index.cjs` — Orama lifecycle: build/load/persist/upsert/query. Owns the
  store + incremental logic.
- `find-docs.cjs` — orchestration + formatting only.

## 8. Config / tunables (constants, documented)

`CHUNK_TOKENS≈400`, `CHUNK_OVERLAP_CHARS≈200`, `RERANK_CANDIDATES≈10`,
`RESULT_LIMIT_DEFAULT=12/max=30`, `MODEL_ID` (dense), `QUERY_PREFIX`,
`RERANKER_ID`, `MODEL_DTYPE`, `SCHEMA_VERSION`, `MAX_FILE_BYTES≈1MB`,
`MAX_CHUNKS_PER_FILE≈200`, `RRF_K=60`.

## 9. Model choice (evidence)

Three eval rounds drove these choices (harness: `embed-bench*.mjs`, gold-set
retrieval, hit@1/hit@3/MRR).

**Round 1 — easy set (this repo, 43 docs, 20 clean NL queries).** Chunked
dense-only: MiniLM 90%/.938; gte-large & jina-v2 95%/.975; nomic 95%/.967;
bge-small 100%/1.000. Signal: **once chunked, dense model barely matters** and
the set is saturated. A reranker *hurt* here (90%→85%) — but the set was too easy
to trust that.

**Round 2 — hard set (a real client repo `docs/`, 82 docs, 36 passage-retrieval queries).**
Dense-only drops to 67–72% — real corpora expose that embeddings alone are weak.
Hybrid(BM25+dense) beats dense-only by ~8 pts. **The reranker helps a lot**
(bge-small 75%→94% hit@1). This *reversed* the Round-1 "drop rerank" call.

**Round 3 — full pipeline with stronger models (a real client repo `docs/`).**

| dense | +hybrid | +hybrid+rerank |
|---|---|---|
| **bge-small** (384d, ~90MB) | 75% / .870 | **94% / .965** |
| bge-base (768d, ~440MB) | 67% / .796 | 78% / .846 |
| gte-base (768d, ~440MB) | 67% / .791 | 78% / .849 |

**Bigger dense models were worse, not better** — the full ranking (hybrid+rerank):
bge-small 94% > nomic 89% > jina-v2 86% > gte-large 83% > bge-base/gte-base 78%.
Smallest model wins on quality *and* footprint.

**Round 4 — semantic correctness (a real client repo `docs/`, 36 *paraphrased* NL queries,
no verbatim overlap).** The truest test of real usage:

| config | hit@1 | MRR |
|---|---|---|
| **bge-small dense-only** | **89%** | **0.927** |
| bge-small + hybrid | 89% | 0.926 |
| bge-small + hybrid + **rerank** | **75%** | 0.844 |
| nomic + hybrid + rerank | 86% | 0.910 |

**The reranker's effect tracks literal query↔doc overlap:** it *helped* verbatim
queries (+19, Round 3) but *hurt* paraphrased ones (−14, Round 4). The cross-encoder
rewards literal overlap; on paraphrase it mis-judges and demotes the right doc
below what the dense model already had. Hybrid(BM25) is neutral on semantic
(89%→89%) and +8 on lexical — robust either way.

**Locked configuration:**
- **Dense:** `bge-small-en-v1.5` (384-dim, ~90 MB, query prefix). Wins every round.
- **Hybrid:** BM25 + dense (Orama), `hybridWeights {text:0.2, vector:0.8}` —
  vector-heavy. **Round 5 (real shipped Orama pipeline, not the RRF proxy)** on
  the real-repo paraphrase set: 0.2/0.8 → 81% hit@1 / 0.884 MRR vs 58% at the
  initial 0.5/0.5. Chunk over-fetch `CAND=60` before collapsing to files.
- **Reranker:** `Xenova/bge-reranker-base` — **built, OFF by default**, opt-in per
  repo (§5.5). High-variance; helps literal, hurts paraphrased; `find_docs`
  queries skew paraphrased.
- **Expected correctness (default config) on real docs:** ~**89% hit@1 / 0.93 MRR**
  on natural-language queries.

Caveat: both gold sets are semi-synthetic (verbatim lines vs authored
paraphrases); real usage sits between them. The reranker's helps-literal /
hurts-paraphrase behavior is consistent and mechanistically explained, so it is
trusted enough to justify off-by-default.

## 10. Migration & rollout

1. Both plugins updated identically; comment marks them as lockstep copies.
2. `package.json` (both plugins) gains `@orama/orama` +
   `@orama/plugin-data-persistence`. Installed by the existing SessionStart
   `npm install` hook — same mechanism as `@huggingface/transformers`. Pure JS,
   no native build.
3. **Version-key the plugin caches** — bump both plugin `version`s so the
   version-keyed plugin cache redeploys.
4. `_meta` mismatch (new schema/model) rebuilds the index automatically; old
   JSON embedding cache is orphaned — delete it on first run.
5. First run downloads the small dense model (~90–130 MB) + `bge-reranker-base`
   (~one-time). Reindex may take ~1–3 min for ~2k chunks, then incremental.
6. **Docs-sync:** update each plugin `README.md` (tool description / model
   footprint) and the `reindex` command doc (model download size note).

## 11. Testing / verification

- Promote the gold-set harness (`embed-bench*.mjs`) into a **repeatable eval**
  kept in-repo; run before/after and gate on **no hit@1 regression vs baseline**
  and target **≥ baseline MRR**, with reranker expected to lift hit@1.
- Unit-test `chunker.cjs` (heading breadcrumbs, overlap, empty/edge docs).
- End-to-end: run `reindex`, then a set of `find_docs` queries; confirm section
  anchors resolve and the store persists/reloads.

## 12. Risks & mitigations

- **Orama OSS cadence** (company pivoted to cloud in 2025): pin a version; the
  API surface we use (insert/search hybrid/persist) is small and stable.
- **Reranker latency:** bounded to top-N≈20; fp32 vs q8 dtype is a tunable if
  too slow.
- **Index build time / RAM:** incremental by mtime; small dense model keeps
  resident RAM low; chunk vectors at 384-dim keep the store compact.
- **Worker startup:** two model loads (embedder + reranker); lazy/parallel warm,
  graceful degradation to hybrid-only if reranker fails.

## 13. Open items (resolve during implementation)

- Reranker dtype (fp32 vs q8) — decide from measured query latency on real
  hardware; fp32 used in evals.
- Exact Orama persistence API/format + hybrid-search option names — confirm
  against the installed `@orama/orama` version before wiring `doc-index.cjs`.
- Whether to keep a second worker for the reranker or run it in the embedder
  worker — decide on startup-time/RAM measurement.
