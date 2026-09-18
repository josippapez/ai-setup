---
description: Score a change to the verified gate's claim patterns against the stored replay ledger, and ship it only if it does not score worse.
---

Run the replay scorer over the ledger and report what it says.

```sh
node "${CLAUDE_PLUGIN_ROOT}/hooks/replay.cjs" $ARGUMENTS
```

The ledger holds one node per evaluated turn, each carrying the answer text and
the evidence manifest as they were, so a different claim configuration can be
scored against the whole history without re-running a single tool call.

To evaluate a change, copy `hooks/claim-patterns.cjs`, edit the copy, and pass it:

```sh
node "${CLAUDE_PLUGIN_ROOT}/hooks/replay.cjs" --candidate /tmp/patterns-candidate.cjs
```

The scorer prints `SHIP` when the candidate scores at least as well as the config
in place and `REJECT` otherwise. Report which it was and the two scores. On
`REJECT`, do not apply the change: the current configuration stays, which is the
whole point of the check.

Read the numbers back as: `catches` are blocks where the flagged claim actually
changed on the next turn, `false-positives` are blocks where it came back
identical, and `blocked` is the total rounds spent. A candidate that raises
catches by adding twice as many false positives is worse, and the score says so.
