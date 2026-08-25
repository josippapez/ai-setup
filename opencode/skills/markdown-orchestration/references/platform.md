# OpenCode platform adapter

This file contains OpenCode-only mechanics. Common behavior belongs in the other references.

The native skill tool loads `SKILL.md` and reports the skill's absolute Base directory. The dispatcher captures that directory as `skillRoot`; sibling references/templates are not automatically loaded.

## Names and tools

OpenCode agents use bare file-derived `subagent_type` names listed in `routing.md`. Companion skills are `grilling`, `grill-with-docs`, `domain-modeling`, `wcag-guidelines`, and existing `agent-browser`; load them with the native `skill` tool. Repository grounding uses `interactive-mcp-standalone_*` tools. Use the native `task` tool for subagents and `question` for every user prompt.

## Models

Worker ladder: `md-worker-free` → `md-worker-terra` → `md-worker-luna` → `md-worker-sol`. Chunk `complexity` picks the variant directly:

| complexity | Worker | The chunk looks like |
| --- | --- | --- |
| `low` | `md-worker-free` | Mechanical and fully specified. Rename, move, config edit, add a field, apply a stated pattern to more call sites, docs edit. The Description leaves no judgement to the worker. |
| `medium` | `md-worker-terra` | Ordinary feature or fix. One or two files, a known approach. |
| `high` | `md-worker-luna` | Cross-cutting or novel. Many files or an unclear approach. |
| `max` | `md-worker-sol` | High-risk implementation, architecture, or a disputed gate. |

Force a chunk up one tier, never down, when it touches security/auth, data migrations, concurrency, money, or a public interface, whatever its size.

Free is the default for `low`, not a special case to justify. Under-using it is the common failure: work fully specified in the Description does not get better on a bigger model. Planning and verdict work never uses Free. Exact specialist variants are in `routing.md`.

## Nested dispatch

`subagent_depth: 2` permits one bounded worker review layer. Worker agent permissions must explicitly allow every nested specialist. If task dispatch is unavailable, the worker relays review requests to the orchestrator and never self-approves.

Every blocking worker checker/reviewer `task` call MUST explicitly set `background: false`, including calls issued in parallel. A response that only reports the task as running, queued, pending, or completing in the background is not a verdict: keep the issue `In Review` until a completed `pass`/`fail` result arrives, or relay the unresolved gate to the orchestrator when no synchronous join is available. Never record such an acknowledgement as a pass or use it to set `Done`.

## Isolation

OpenCode tasks share the workspace, so isolation is decided by **file overlap, not wave size**. Apply this rule per wave:

| Concurrent mutating chunks in the wave | Isolation |
| --- | --- |
| One chunk | Run in the active workspace. |
| Two or more, **disjoint** scopes (no file written by more than one) | Run all of them **in the active workspace, in parallel**. No worktree. |
| Two or more that **overlap** — same file, or a shared file one rewrites | Orchestrator prepares and assigns one worktree path per overlapping chunk, then integrates on join. |
| Two or more, overlap **unknown or disputed** | Assign worktrees. A wrong "disjoint" call means workers clobbering each other's edits. |

Take overlap from the impl-planner `conflicts` output, not from a guess.

Wave size ≥2 is **not** by itself a reason to use worktrees, and worktree cost is **not** a reason to serialize a wave. A worktree needs its own dependency install and build cache before checks run, which can cost more than the chunks it isolates — that is an argument for running disjoint chunks in the active workspace, never for collapsing a parallel wave into sequential waves. If you serialize genuinely disjoint chunks, you have applied this rule wrong.

Dependent chunks start only after prerequisites are visible. Store paths always point to the main repo.

## Installation and landing

Global installation is managed by `opencode/install.sh`. Installation does not authorize git landing. Never create a branch, commit, merge, push, or open a PR until the user explicitly selects that action. If approved, use the named target and report it; otherwise leave changes uncommitted/in place.
