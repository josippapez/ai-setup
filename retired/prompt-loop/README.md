# Retired: interactive prompt-loop guidance

Parked here on 2026-07-30 because the agent behavior it enforced is now covered by
the agents themselves. Kept in the repo (but **outside** `claude/` and `opencode/`,
so neither installer deploys it) in case it needs to come back.

## What's here

| File | Was deployed as |
| --- | --- |
| `claude/rules/user-interaction.instructions.md` | always-on rule, injected by the interactive-mcp plugin's `inject-rules.cjs` SessionStart hook |
| `claude/skills/prompt-user/SKILL.md` + `interactive-prompt-loop.instructions.md` | `interactive-mcp:prompt-user` skill |
| `opencode/rules/user-interaction.instructions.md` | always-on rule → `~/.config/opencode/rules/` |
| `opencode/rules/interactive-prompt-loop.instructions.md` | always-on rule → `~/.config/opencode/rules/` |
| `opencode/skills/prompt-user/SKILL.md` | OpenCode skill → `~/.config/opencode/skills/` |

The policy these files carried: use the built-in questions tool for all interactive
communication, confirm scope before each task, run a mandatory
`Are you satisfied with this result, or would you like any changes?` check after each
delivery, and continue the loop until an exact stop phrase.

## Still live elsewhere (by choice)

The check-in reminder hooks were kept, but rewritten so they no longer cite this
retired policy and no longer spam:

- `claude/hooks/scripts/prompt-loop-reminder.mjs` — now wired to `UserPromptSubmit`
  only (was also `PostToolUse` on every Edit/Write and `SessionStart`), and
  throttled to one reminder per session per 30 minutes
  (`PROMPT_LOOP_REMINDER_INTERVAL_MS`, state under `PROMPT_LOOP_STATE_DIR`).
  Covered by `prompt-loop-reminder.test.mjs`, including a guard test that fails if
  the reminder text ever cites this retired policy again.
- `opencode/plugins/prompt-loop-reminder.js` — reduced to a single system-prompt
  line; its per-question-tool output rewriting and stop-phrase policy are gone.

One lesson from this policy was kept in live guidance rather than retired: the
**deliverable visibility** rule (never bury an answer above a questions-tool widget —
the widget hides the text before it) now lives in `proactive-execution.md` in both
adapters.

## Restoring

`git mv` the files back to the paths in the table above, then re-run the installers
(`bash claude/install.sh`, `bash opencode/install.sh`). The claude plugin version must
be bumped for the rules change to land, since the plugin cache is version-keyed.
