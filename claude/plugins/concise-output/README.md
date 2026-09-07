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

## The post-compaction exemplars

`hooks/inject-post-compact-exemplars.cjs` runs on `SessionStart` and exits without output
unless `source` is `compact`. Then it injects three short specimen question-and-answer
pairs, on subjects unrelated to any repo, so only the target length and shape transfer.

Compaction leaves the style itself untouched, which is the point of shipping it as an
output style. What it removes is the session's own short answers. Measured with the
benchmark's arms N and Q (identical plugins, `/compact` after turn 37, four questions
re-asked verbatim): without the hook the re-asked answers grew past their originals on all
four (median 510 chars against a 389 pre-boundary median); with it, three of four came back
shorter and the median fell to 327. More copies of the rules is not what was missing, and
re-injection already happens: dev-core's `SessionStart` hook re-fires on the compact source
and both per-prompt digests keep firing. `PostCompact` is the wrong event here, since it
carries no `additionalContext`.

There is no OpenCode mirror: this hangs off a Claude Code `SessionStart` source.

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

Five tests: the style's frontmatter contract, that the former rules are not double-injected,
that the style carries both former rules' substance, that the digest points at the full rules,
and that the exemplar hook stays silent unless the session started from a compaction.
