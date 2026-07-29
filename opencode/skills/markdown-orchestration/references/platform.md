# OpenCode platform adapter

This file contains OpenCode-only mechanics. Common behavior belongs in the other references.

The native skill tool loads `SKILL.md` and reports the skill's absolute Base directory. The dispatcher captures that directory as `skillRoot`; sibling references/templates are not automatically loaded.

## Names and tools

OpenCode agents use bare file-derived `subagent_type` names listed in `routing.md`. Companion skills are `grilling`, `grill-with-docs`, `domain-modeling`, `wcag-guidelines`, and existing `agent-browser`; load them with the native `skill` tool. Repository grounding uses `interactive-mcp-standalone_*` tools. Use the native `task` tool for subagents and `question` for every user prompt.

## Models

Worker ladder: `md-worker-free` → `md-worker-terra` → `md-worker-luna` → `md-worker-sol`. Free handles explicit mechanical work; Terra handles narrow execution/checks; Luna handles routine reasoning/review; Sol is reserved for high-risk implementation, architecture, or disputed gates. Planning and verdict work never uses Free. Exact specialist variants are in `routing.md`.

## Nested dispatch

`subagent_depth: 2` permits one bounded worker review layer. Worker agent permissions must explicitly allow every nested specialist. If task dispatch is unavailable, the worker relays review requests to the orchestrator and never self-approves.

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
