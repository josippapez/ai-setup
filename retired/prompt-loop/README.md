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

## Still live elsewhere

Retiring these files did **not** remove the enforcement hooks. Both still fire and
still inject the prompt-loop reminder every turn:

- `claude/hooks/scripts/prompt-loop-reminder.mjs`, wired into `SessionStart`,
  `UserPromptSubmit`, and `Stop` in `claude/settings.json`.
- `opencode/plugins/prompt-loop-reminder.js`, listed in `opencode/opencode.json`.

Retire those too if the reminder text is unwanted — otherwise the hooks keep asking
for a satisfaction prompt that no rule defines any more.

One lesson from this policy was kept in live guidance rather than retired: the
**deliverable visibility** rule (never bury an answer above a questions-tool widget —
the widget hides the text before it) now lives in `proactive-execution.md` in both
adapters.

## Restoring

`git mv` the files back to the paths in the table above, then re-run the installers
(`bash claude/install.sh`, `bash opencode/install.sh`). The claude plugin version must
be bumped for the rules change to land, since the plugin cache is version-keyed.
