# Proactive Doc-Context Injection — Design

**Date:** 2026-07-16
**Status:** Draft (awaiting user review)
**Plugin:** `interactive-mcp` (Claude Code first; OpenCode parity deferred)

## Problem

The plugin already indexes every repo Markdown file into a chunked/Orama hybrid-search index (`find_docs`). But the agent only uses it when it *chooses* to call `find_docs`. Repo-specific questions are often answered from general knowledge instead of the local docs that would ground them. We want the most relevant docs surfaced **automatically**, at natural points in the conversation, so the agent reads them (via `read_doc`) — without the user having to say "check the docs."

## Goals

- On each user prompt, and as the agent works mid-turn, automatically inject a short, ranked list of relevant doc pointers **when, and only when, they clear a relevance threshold**.
- Reuse the existing engine (bge-small embedder + Orama hybrid search). No new model.
- Zero added latency on the critical path beyond a fast local socket round-trip (~ms).
- Silent when nothing is relevant — never noise, never break a turn.

## Non-goals (v1)

- No generative LLM judge. The "is search necessary?" gate is a **score threshold** on the existing hybrid search (a Gemma/Qwen-class judge is a possible v2, explicitly deferred).
- No new model download beyond the engine's existing bge-small.
- Not a replacement for `find_docs`/`read_doc` — it's an automatic nudge that points at them.
- OpenCode parity is deferred to a follow-up (its hook API differs).

## Approved decisions (from brainstorming)

- **Decision engine:** embedder + score threshold (reuse warm bge-small; no second model).
- **Warm-model access:** the **already-running MCP server hosts a local socket** (revised from a standalone sidecar once the double-model cost became visible). The MCP server already has the deps, `NODE_PATH`, warm embedder worker, and loaded index — so it hosts the injection endpoint; a fresh per-event hook process just connects as a client. **One** model instance total.
- **Trigger combination:** **`UserPromptSubmit`** (primary) + **`PostToolBatch`** (continuous, fallback `PostToolUse`). `MessageDisplay` ruled out (its `displayContent` only changes on-screen text, not what Claude sees). `Stop` ruled out for v1 (it forces the turn to continue — wrong semantics for a passive nudge).
- **Injection field:** `hookSpecificOutput.additionalContext` (confirmed available on all chosen events).
- **Scope:** Claude first, then mirror to OpenCode.

## Architecture

Three units, each independently testable:

### 1. Injection socket, hosted by the MCP server (`lib/inject-server.cjs`)

The MCP server (`standalone-mcp.cjs`) opens a local socket on `initialize`, after `warmUp()` + the background `buildDocIndex()` — reusing its already-warm embedder worker and the index it maintains. No second process, no second model.

- **Holds nothing new:** reuses the running `lib/semantic-index.cjs` worker (`embedQuery`) + `lib/doc-index.cjs` (`loadIndex` + `hybridSearch`) against the same `.claude/repo-docs/repo-docs-index.json`.
- **Transport:** a Unix domain socket at `<repo-root>/.claude/repo-docs/inject.sock` (dir already git-ignored). Newline-delimited JSON.
  - Request: `{ "query": string, "limit"?: number, "threshold"?: number }`
  - Response: `{ "hits": [{ "path", "startLine", "heading", "snippet", "score" }], "injected": boolean }`
- **Ranking:** reuses a shared `rankDocs(context, {query, limit, threshold})` helper (extracted from `find_docs` so both share one code path) — `embedQuery` → `hybridSearch` → one-result-per-file collapse → `score >= threshold` filter → cap to `limit`.
- **Hosting guard (two byte-identical claude runtimes):** both the `interactive-mcp` and `markdown-orchestration` MCP servers run this identical runtime. Hosting is gated by **`REPO_DOCS_INJECT=1`**, set only in `interactive-mcp`'s `.mcp.json` env, and a **first-to-bind-wins** `EADDRINUSE` backoff so a second server never collides. The runtime code stays byte-identical across both copies (only the env differs), preserving the epic's byte-identity invariant.
- **Lifecycle:** lives with the MCP server (starts on `initialize`, dies with it). Cleans a stale socket on bind. If the index isn't built yet → `{ hits: [], injected: false }` (silent).
- **Concurrency:** single embedder thread; requests serialize through the existing worker queue. Fine for interactive rates.

### 2. Hook scripts

Small Node scripts under `claude/hooks/scripts/`, modeled on the existing `prompt-loop-reminder.mjs` (read stdin JSON → decide → print). Each:

1. Parses the event JSON from stdin (gets `transcript_path`, prompt/tool data).
2. Derives a query (below).
3. Connects to the socket (short timeout, e.g. 300 ms). **If the socket is absent or times out → exit 0, inject nothing** (never spawn the model inline; never block the turn). **Socket-presence IS the activation gate** — the hooks do NOT read an enable env (they can't see the server's `.mcp.json` env anyway). Server hosting the socket ⇔ injection live.
4. If `injected` and hits present → prints a compact `hookSpecificOutput.additionalContext` block. Else exit 0.

**Bundled in the plugin (self-contained):** the hook scripts live in `claude/plugins/interactive-mcp/hooks/` (as `.cjs`, matching the existing `inject-rules.cjs`) and are registered in the plugin's **own** `hooks/hooks.json` via `${CLAUDE_PLUGIN_ROOT}`. Installing the plugin auto-registers them — **no `claude/settings.json` edit, nothing manual outside the plugin.**

- **`inject-on-prompt.cjs` (`UserPromptSubmit`):** query = the submitted prompt text.
- **`inject-on-progress.cjs` (`PostToolBatch`, fallback `PostToolUse`):** query = derived from `transcript_path` — the latest user message (captures topic drift mid-turn). Applies a **higher threshold** than the prompt hook and **per-session dedup** so the same doc isn't re-injected repeatedly.

**Injection format (compact):**
```
[repo-docs] Possibly relevant local docs — open with read_doc if useful:
1) path/to/doc.md:42 › Section heading — short snippet…
2) …
```

### 3. Reuse

The inject-socket imports the plugin's existing engine libs verbatim (`semantic-index.cjs`, `doc-index.cjs`). No engine changes required — this feature sits *on top of* the index built by the (now incremental) builder.

## Data flow

```
User prompt
  └─ UserPromptSubmit hook ──(socket)──▶ inject-socket ──▶ ranked hits ≥ threshold
        └─ additionalContext ──▶ agent sees pointers ──▶ (maybe) read_doc

Agent runs tools …
  └─ PostToolBatch hook ──(socket)──▶ inject-socket ──▶ hits ≥ (higher) threshold, minus already-injected
        └─ additionalContext ──▶ injected before next model call
```

## Configuration

**Single activation toggle — `REPO_DOCS_INJECT` in the plugin's `.mcp.json`** (reaches the MCP server, which hosts the socket). **On by default** (shipped `=1`): the server hosts the socket, the bundled hooks detect it, injection is live out of the box. Set it to `0`/unset to disable — no socket → hooks silently no-op.

Optional tuning via ambient env (read by the server/hooks if present, else defaults):

- `REPO_DOCS_INJECT_THRESHOLD` — prompt-hook threshold (default from calibration).
- `REPO_DOCS_INJECT_THRESHOLD_PROGRESS` — higher threshold for the progress hook.
- `REPO_DOCS_INJECT_LIMIT` — max pointers (default 3).
- `REPO_DOCS_INJECT_TIMEOUT_MS` — socket connect timeout (default 300).
- `REPO_DOCS_INJECT_EVENTS` — `prompt,batch` (turn off the mid-turn trigger with `prompt`).

## Threshold calibration

Orama hybrid scores are not cleanly normalized to 0–1, so the default threshold must be **empirically calibrated**, not guessed. Plan: a `DEBUG` mode that injects hits with their scores over a set of representative repo prompts; pick thresholds that inject on genuinely-relevant prompts and stay silent on chit-chat. Ship the calibration script; set defaults from its output. **This is a required task, not an afterthought.**

## Noise control

- Silent below threshold (the default state for most prompts).
- Per-session dedup of injected doc paths (small state file under `.claude/repo-docs/inject-state/<session>.json`).
- Cap to top N (default 3), snippet-trimmed.
- Skip trivial prompts (very short / no alphabetic content) on the prompt hook.

## Testing

- **rankDocs / inject-server:** query returns ranked hits above threshold; missing-index → `injected:false`; stale-socket recovery on bind; `EADDRINUSE` backoff.
- **Hooks:** given event JSON on stdin + a mock socket — emits correct `additionalContext` JSON; stays silent below threshold; **exits 0 when the socket is down**.
- **Calibration:** script over sample prompts producing a score histogram.
- **Integration (manual):** enable, ask a repo question, confirm a pointer block appears and `read_doc` opens it.

## Deploy

- **Fully self-contained in the plugin.** Hook scripts in `claude/plugins/interactive-mcp/hooks/` (`.cjs`), registered in the plugin's own `hooks/hooks.json` (`${CLAUDE_PLUGIN_ROOT}`). **No `claude/settings.json` change** — installing the plugin registers everything. No `SessionStart` spawn — the MCP server hosts the socket on its own `initialize`.
- Socket server module `lib/inject-server.cjs` in the runtime (mirrored to both claude copies for byte-identity); `REPO_DOCS_INJECT=1` shipped in `interactive-mcp`'s `.mcp.json` (on by default). Runtime deps already auto-install into the plugin data dir. Plugin version bump (version-keyed cache).
- docs-sync: document the feature + config in the plugin README / `docs/**`.

## Risks / open items

- **`PostToolBatch` availability** depends on the Claude Code build; fallback to `PostToolUse` (with dedup to avoid per-tool spam).
- **Token cost:** injecting on every prompt + batch adds context; mitigated by threshold gating, compact format, dedup, and a low cap.
- **Threshold default** unknown until calibrated (see above).
- **Socket security:** repo-scoped local Unix socket; low risk, but the inject-socket must validate request shape and never execute injected content.
- **OpenCode parity** deferred — its plugin hook API differs (SessionStart + tool hooks via `interactive-mcp.js`), a follow-up epic.

## Rollout

1. `rankDocs` extraction + `inject-server` socket hosted by the MCP server (unit-tested).
2. `UserPromptSubmit` hook + config plumbing + calibration → ship enabled behind `REPO_DOCS_INJECT=1`.
3. `PostToolBatch`/`PostToolUse` progress hook + dedup.
4. docs-sync + README.
5. (Later) OpenCode parity; (later) optional LLM judge.
