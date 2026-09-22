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

That is one run for it and one neutral. The 2026-09-22 2x2 (arms R/S/T/U, concise-output
alone) did not reproduce the effect: re-ask growth was +91 and +136 chars with the hook,
+114 and +98 without. Those arms answered at a 450-char median against 876-1,042 in the
N/Q pair, because dev-core was left out, so there was far less regrowth for 908 chars of
specimens to cut. The hook stays because it costs 908 chars once per compaction, not
because the second run confirmed it.

There is no OpenCode mirror: this hangs off a Claude Code `SessionStart` source.

## The per-prompt reminder

`hooks/inject-rules-digest.cjs` restates `rules-digest.md` on every prompt, because the
system prompt sits far from the current turn in a long session. It is self-contained: it
reads the digest and prints a fixed reminder naming the output style. `dev-core` ships its
own digest hook for its own rules; the two were one copy-identical file until 2026-09-22,
when the shared branch that sniffed for `output-styles/` was dropped here. That branch
could never run in this plugin, and it was where the wording had silently drifted stale.

This is the hook the 2026-09-22 2x2 vindicated. The style bans em dashes; without the
digest the ban decays with session depth, and the decay is the whole effect:

| arm | digest | em dashes, turns 1-19 | turns 20-37 | total over 42 turns |
|---|---|---|---|---|
| R | on | 6 | 0 | 6 |
| T | on | 0 | 0 | 0 |
| S | off | 11 | 23 | 34 |
| U | off | 10 | 19 | 29 |

Length did not move with it (450-488 char medians across all four arms), so the digest buys
rule compliance, not brevity. It is not free: measured in arm R, 1,593 chars per prompt and
66,906 chars (~16.7k tokens) over 42 turns, and a real session pays dev-core's copy on top.
The digest was cut to 936 bytes on 2026-09-22 for that reason, and arm V re-ran the same
43 prompts on the trimmed copy: 1,280 chars per prompt instead of 1,593, zero em dashes,
474-char median. The cut clauses were restatements, not the ban itself.

## Tests

```bash
node --test claude/plugins/concise-output/output-styles/output-style.test.cjs
```

Five tests: the style's frontmatter contract, that the former rules are not double-injected,
that the style carries both former rules' substance, that the digest points at the full rules,
and that the exemplar hook stays silent unless the session started from a compaction.
