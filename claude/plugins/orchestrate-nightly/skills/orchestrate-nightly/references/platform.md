# Claude platform adapter (nightly)

Claude-only mechanics for the nightly workflow. Common behavior belongs in the other references.

Claude Code substitutes `${CLAUDE_SKILL_DIR}` with the absolute directory containing the loaded `SKILL.md`. The dispatcher uses it directly as the skill root; bundled references/templates are not automatically loaded.

## Names and tools

Plugin agents use namespaced `subagent_type: orchestrate-nightly:<agent>`. Agents: `repo-scout`, `solution-reuse-scout`, `impl-planner`, `council-member`, `design-lead`, `docs-maintainer`, `test-specialist`, `wcag-reviewer`, `md-builder`, `batch-reviewer`, `md-fixer`.

Companion skills come from the stable plugin, which must stay installed: `orchestrate:grilling`, `orchestrate:grill-with-docs`, `orchestrate:domain-modeling`, `orchestrate:accessibility`. The `mcp__plugin_repo-docs_repo-docs__*` tools come from the separate `repo-docs` plugin, which must also stay installed. Use the Skill tool, not slash shorthand.

## Models

Pass `model` on every dispatch; frontmatter is a fallback only. Ladder: haiku → sonnet → opus → fable.

Measured on 23 past workers (Sept 2026 transcripts, first-party API prices): a sonnet worker averaged $6 and 25 minutes, an opus worker $40 and 65 minutes. Reviewer verdicts on opus averaged $7 against $0.90 on sonnet. The nightly policy therefore defaults one tier lower than stable and reserves opus for risk, not size.

| complexity | Build model | The chunk looks like |
| --- | --- | --- |
| `low` | haiku | Mechanical and fully specified: rename, move, config edit, add a field, apply a stated pattern to more call sites, docs edit. No judgement left. |
| `medium` | sonnet | Ordinary feature or fix. Known approach, some structural judgement. |
| `high` | sonnet | Cross-cutting or many files, but no risk tag. Size alone never buys opus in nightly; the batch reviewer catches what a sonnet builder misses and the fixer is cheap. |
| `high` + risk tag | opus | Touches security/auth, data migration, concurrency, money, or a public interface. |
| `max` | opus | Hard-to-reverse, expensive-to-get-wrong decisions. Fable only on explicit user request. |

Risk tags are set at Decompose in the issue frontmatter `risk:` list (`security`, `auth`, `migration`, `concurrency`, `money`, `public-api`). An empty list means no tag.

Role models:

| Role | Model |
| --- | --- |
| repo-scout quick, md-fixer for mechanical fix-lists | haiku |
| repo-scout deep, impl-planner, council-member, design-lead, solution-reuse-scout, docs-maintainer, test-specialist, wcag-reviewer, md-fixer otherwise | sonnet |
| batch-reviewer | sonnet; opus only when any chunk in the batch carries a risk tag |

Never review on haiku. Never build on a tier above the table without a recorded reason.

## No nested dispatch

Nightly agents never spawn agents. `md-builder` runs supplied quality commands and the supplied test suite itself, as commands, and returns. The orchestrator dispatches every reviewer and fixer. This removes the `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` dependency and the relay path for missing nested `Agent`.

## Isolation

Isolation is decided by file overlap, not wave size. Per wave:

| Concurrent mutating chunks in the wave | Isolation |
| --- | --- |
| One chunk | Run in place. |
| Two or more, disjoint scopes | Run all in place, in parallel. No worktree. |
| Two or more that overlap, or overlap unknown | `isolation: worktree` per overlapping chunk; orchestrator integrates on join. |

Take overlap from the impl-planner `conflicts` output. Wave size alone is never a reason for worktrees, and worktree cost is never a reason to serialize disjoint chunks.

## Installation and landing

Plugin installation is managed by `claude/install.sh` and the local marketplace. Installation never authorizes git landing. Never create a branch, commit, merge, push, or open a PR until the user explicitly selects that action.

## Measuring the experiment

`bench/orchestration-cost.cjs` in this plugin reads `~/.claude/projects/**` transcripts and reports cost, wall-clock, and turn counts per agent role, split by plugin namespace, so a stable epic and a nightly epic on comparable work can be compared. Run it after each nightly epic and record the numbers in the close-out brief.
