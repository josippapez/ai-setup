# Claude platform adapter

This file contains Claude-only mechanics. Common behavior belongs in the other references.

Claude Code substitutes `${CLAUDE_SKILL_DIR}` with the absolute directory containing the loaded `SKILL.md`. The dispatcher uses it directly as the skill root; bundled references/templates are not automatically loaded.

## Names and tools

Plugin agents use namespaced `subagent_type: markdown-orchestration:<agent>`. Companion Skill IDs are `markdown-orchestration:grilling`, `markdown-orchestration:grill-with-docs`, `markdown-orchestration:domain-modeling`, and `markdown-orchestration:wcag-guidelines`. Use the Skill tool, not slash shorthand. Repo-docs tools are provided by the plugin MCP. Browser/design tools remain orchestrator-owned unless an agent explicitly declares them.

## Models

Use task model overrides; frontmatter is fallback. Ladder: haiku → sonnet → opus → fable. Every agent here ships `model: sonnet` in frontmatter except `quality-gates-checker`, so **an override you do not pass is an agent running on sonnet**. Pass `model` on every dispatch.

Chunk `complexity` maps to the build model directly:

| complexity | Model | The chunk looks like |
| --- | --- | --- |
| `low` | haiku | Mechanical and fully specified. Rename, move, config edit, add a field, apply a stated pattern to more call sites, docs edit. The Description says exactly what to write and no judgement is left. |
| `medium` | sonnet | Ordinary feature or fix. One or two files, a known approach, some judgement about structure. |
| `high` | opus | Cross-cutting, novel, or risky. Many files, an unclear approach, or it touches security/auth, data migration, concurrency, money, or a public API. |
| `max` | fable | Highest-stakes reasoning only. Rare: a decision that is hard to reverse and expensive to get wrong. |

Force a chunk up one tier, never down, when it touches security/auth, data migrations, concurrency, money, or a public interface, whatever its size.

Haiku is the default for `low`, not a special case to justify. Under-using it is the common failure: work that is fully specified in the Description does not get better on a bigger model, it only costs more.

Read-only and mechanical roles take haiku regardless of chunk complexity: quick repo scouting and quality-gate command runs. Planning, correctness verdicts, implementation quality, design, and WCAG take sonnet minimum. **Review verdicts and impl planning never use haiku**, since a gate that cannot catch a subtle failure is worse than no gate. Routing row policy wins.

## Nested dispatch

`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2` permits a worker to spawn one bounded specialist layer. If Agent is absent, the worker relays review requests to the orchestrator; it never retries indefinitely or self-approves.

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
