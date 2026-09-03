# concise-output

An output style and one skill, all about how output reads. Split out of `dev-core`
so the writing rules can be disabled or reused without giving up repo grounding and the
engineering rules.

- `output-styles/concise-output.md` — the writing rules, as a Claude Code output style.
  How long (lead with the result, one to three sentences, detail and explanation opt-in)
  and what is in it (anything posted, pushed, or sent on the user's behalf carries only
  what was asked for). Covers chat, code comments, commits, PR and issue text, docs, and
  logs. Agent-to-agent traffic is exempt.
- `skills/concise-pr-comments/` — how a review comment should read, distilled from the
  user's own review history.

## Why an output style rather than injected rules

Output styles go into the system prompt; hook-injected context goes into the
conversation. Two consequences, both from the
[context-window docs](https://code.claude.com/docs/en/context-window): at compaction the
system prompt and output style are "unchanged; not part of message history", while
"context that hooks added earlier" is "summarized with the rest of the conversation".
The style also needs no sharding around the 10,000-character `additionalContext` cap.

Frontmatter that matters:

- `keep-coding-instructions: true` — without it Claude Code drops its own software
  engineering instructions, which would be a bad trade for a coding setup.
- `force-for-plugin: true` — applies whenever this plugin is enabled, overriding the
  user's `outputStyle` setting. If several enabled plugins force a style, the first one
  loaded wins. Disabling this plugin falls back to whatever `outputStyle` names.

Output styles reach the main conversation only, not subagents. That matches the rules'
own agent-to-agent exemption, and hook-injected context never reached subagents either.

## The per-prompt reminder

`hooks/inject-rules-digest.cjs` restates `rules-digest.md` on every prompt, because the
system prompt sits far from the current turn in a long session. It checks whether the
plugin ships `output-styles/` and words the reminder accordingly, so the file stays
copy-identical with the `dev-core` version, which still injects `rules/` at SessionStart.
`dev-core` owns the canonical copy; changes belong there first.

## Tests

```bash
node --test claude/plugins/concise-output/output-styles/output-style.test.cjs
```
