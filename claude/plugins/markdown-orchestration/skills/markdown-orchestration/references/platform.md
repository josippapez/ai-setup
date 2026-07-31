# Claude platform adapter

This file contains Claude-only mechanics. Common behavior belongs in the other references.

Claude Code substitutes `${CLAUDE_SKILL_DIR}` with the absolute directory containing the loaded `SKILL.md`. The dispatcher uses it directly as the skill root; bundled references/templates are not automatically loaded.

## Names and tools

Plugin agents use namespaced `subagent_type: markdown-orchestration:<agent>`. Companion Skill IDs are `markdown-orchestration:grilling`, `markdown-orchestration:grill-with-docs`, `markdown-orchestration:domain-modeling`, and `markdown-orchestration:wcag-guidelines`. Use the Skill tool, not slash shorthand. Repo-docs tools are provided by the plugin MCP. Browser/design tools remain orchestrator-owned unless an agent explicitly declares them.

## Models

Use task model overrides; frontmatter is fallback. Ladder: haiku → sonnet → opus → fable. Quick scouting/mechanical checks may use haiku. Workers scale by complexity. Planning/correctness/implementation-quality/design/WCAG use sonnet minimum; escalate high-risk work to opus and only highest-stakes reasoning to fable. Review verdicts and impl planning never use haiku. Routing row policy wins.

## Nested dispatch

`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2` permits a worker to spawn one bounded specialist layer. If Agent is absent, the worker relays review requests to the orchestrator; it never retries indefinitely or self-approves.

**`Agent` is asynchronous only on this platform, and that changes who joins a review.** There is no `background: false` parameter and no synchronous mode: a dispatch returns "launched, you will be notified", and the completion notification is delivered to the **orchestrator**, not to the subagent that spawned it. A depth-1 worker therefore cannot reliably join its own reviewers inside its turn.

Consequences, which are mandatory rather than advisory:

- A worker that has dispatched gates but holds no completed `pass`/`fail` puts the outstanding gates in `relay`, leaves the issue `In Review`, and returns. The orchestrator runs the review loop and applies the final status. This is the designed path, not a degraded fallback.
- Waiting is forbidden. No filler/idle "wait" agents, no `Monitor` polling for a reviewer's completion, no sleep loops. One observed worker spawned five throwaway agents plus a Monitor, spent ~140k tokens and ~18 minutes, and still had to relay.
- A "running", "queued" or "pending" acknowledgement is never a verdict and must never be recorded as a pass or used to set `Done`.

Note the asymmetry with the OpenCode adapter, which fixes the same hazard by requiring `background: false` on blocking review calls. That parameter does not exist here, so the Claude answer is relay-first rather than force-synchronous. Do not port the OpenCode wording across.

## Isolation

Isolation is decided by **file overlap, not wave size**. Apply this rule per wave:

| Concurrent mutating chunks in the wave | Isolation |
| --- | --- |
| One chunk | Run in place. |
| Two or more, **disjoint** scopes (no file written by more than one) | Run all of them **in place, in parallel**. No worktree. |
| Two or more that **overlap** — same file, or a shared file one rewrites | `isolation: worktree` per overlapping chunk; orchestrator integrates on join. |
| Two or more, overlap **unknown or disputed** | `isolation: worktree`. A wrong "disjoint" call means workers clobbering each other's edits. |

Take overlap from the impl-planner `conflicts` output, not from a guess.

Wave size ≥2 is **not** by itself a reason to use worktrees, and worktree cost is **not** a reason to serialize a wave. A worktree needs its own dependency install and build cache before checks run, which can cost more than the chunks it isolates — that is an argument for running disjoint chunks in place, never for collapsing a parallel wave into sequential waves. If you serialize genuinely disjoint chunks, you have applied this rule wrong.

Dependent chunks run only after prerequisites are integrated into their base. Store paths always point to the main repo.

## Installation and landing

Plugin installation is managed by `claude/install.sh` and the local marketplace. Installation does not authorize git landing. Never create a branch, commit, merge, push, or open a PR until the user explicitly selects that action. If approved, use the named target and report it; otherwise leave changes uncommitted/in place.
