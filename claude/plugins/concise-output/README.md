# concise-output

Two always-on rules and one skill, all about how output reads. Split out of `dev-core`
so the writing rules can be disabled or reused without giving up repo grounding and the
engineering rules.

- `rules/concise-output.instruction.md` — how long. Every response is a summary of the
  outcome, not a narrative of the process: lead with the result, one to three sentences,
  detail and explanation opt-in. Covers chat, code comments, commits, PR and issue text,
  docs, and logs. Agent-to-agent traffic is exempt.
- `rules/outbound-content.md` — what is in it. Anything posted, pushed, or sent on the
  user's behalf carries only what was asked for.
- `skills/concise-pr-comments/` — how a review comment should read, distilled from the
  user's own review history.

`hooks/inject-rules.cjs` shards the rules into SessionStart context (Claude Code has no
native plugin rules loader) and `hooks/inject-rules-digest.cjs` restates
`rules-digest.md` on every prompt. Both are copies of the `dev-core` versions and name
their plugin from `.claude-plugin/plugin.json`, so the same file works in either plugin.
`dev-core` owns the canonical copy; changes belong there first.
