---
description: Score a change to the verified gate's claim patterns against the stored replay ledger, and ship it only if it does not score worse.
---

Run the replay scorer over the ledger and report what it says.

```sh
VERIFIED_HOME="${CLAUDE_PLUGIN_DATA}/verified" node "${CLAUDE_PLUGIN_ROOT}/hooks/replay.cjs" $ARGUMENTS
```

The ledger lives in the plugin data directory, which only the hook gets as an
environment variable. Without `VERIFIED_HOME` the CLI looks in `~/.claude/verified`,
finds nothing, and reports an empty ledger no matter how many turns it has scored.

The ledger holds one node per evaluated turn, each carrying the answer text and
the evidence manifest as they were, so a different claim configuration can be
scored against the whole history without re-running a single tool call.

To evaluate a change, copy `hooks/claim-patterns.cjs`, edit the copy, and pass it:

```sh
VERIFIED_HOME="${CLAUDE_PLUGIN_DATA}/verified" node "${CLAUDE_PLUGIN_ROOT}/hooks/replay.cjs" --candidate /tmp/patterns-candidate.cjs
```

Scoring over transcripts instead of the ledger needs a fixed world set, or a
winner on one run can lose on the next. Pin it once, then replay:

```sh
VERIFIED_HOME="${CLAUDE_PLUGIN_DATA}/verified" node "${CLAUDE_PLUGIN_ROOT}/hooks/replay.cjs" --pin
```

Pinning is append-only: re-running admits new sessions and never drops old ones.

The scorer prints `SHIP` when the candidate scores at least as well as the config
in place and `REJECT` otherwise. Report which it was and the two scores. On
`REJECT`, do not apply the change: the current configuration stays, which is the
whole point of the check.

Read the numbers back as: `catches` are blocks where the flagged claim actually
changed on the next turn, `false-positives` are blocks where it came back
identical, and `blocked` is the total rounds spent. A candidate that raises
catches by adding twice as many false positives is worse, and the score says so.
