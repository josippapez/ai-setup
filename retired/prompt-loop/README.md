# Retired: interactive prompt-loop guidance

Parked here on 2026-07-30 (rules and skills) and 2026-08-28 (the reminder hooks)
because the agent behavior they enforced is now covered by the agents themselves. Kept in the repo (but **outside** `claude/` and `opencode/`,
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

## The reminder hooks (retired 2026-08-28)

The check-in reminder hooks outlived the policy by a month, then went too. They
printed a per-turn nudge to close with the deliverable and ask for changes, which the
agents now do on their own.

| File | Was deployed as |
| --- | --- |
| `claude/hooks/scripts/prompt-loop-reminder.mjs` (+ `.test.mjs`) | `UserPromptSubmit` hook in `claude/settings.json`, copied to `~/.claude/hooks/scripts/` |
| `opencode/plugins/prompt-loop-reminder.js` | entry in `opencode.json`'s `plugin` array |

Unregistering them is part of the retirement: the `UserPromptSubmit` block is gone
from `claude/settings.json`, the plugin entry is gone from `opencode/opencode.json`,
and `claude/install.sh` now deletes the stale deployed copy.

One lesson from this policy was kept in live guidance rather than retired: the
**deliverable visibility** rule (never bury an answer above a questions-tool widget,
the widget hides the text before it) lives in `proactive-execution.md` in both
adapters.

## Restoring

`git mv` the files back to the paths in the tables above, re-register the hook in
`claude/settings.json` and the plugin in `opencode/opencode.json`, then re-run the installers
(`bash claude/install.sh`, `bash opencode/install.sh`). The claude plugin version must
be bumped for the rules change to land, since the plugin cache is version-keyed.
