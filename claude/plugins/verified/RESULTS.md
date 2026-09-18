# Measured results

What the gate scores on the pinned replay history, per commit, so a later change
can be judged against a number instead of a memory of one.

## The history

596 transcripts, 3260 turns, pinned 2026-09-18 into `~/.claude/verified/worlds.lock.json`.
Append-only: `--pin` admits new sessions, nothing is ever dropped. Every number
below is on this set unless it says "last 7 days" (776 turns).

## The scorer

`hooks/labels.cjs` as of `9f92298`. Three labels per flag: catch, proven false
positive, unknown (charged nothing). V = catch − fp − 0.25·blocked turns.

- A path flag is a catch when the file is not on disk from cwd, the git root, or
  the tracked-file list. Replaying old sessions, 21.3% (under 7 days) / 31.2%
  (older) of files a Read provably opened are also gone now, so that share of
  every such flag is scored as fp. Live, that share is zero.
- A flag is proven wrong only when the session had the check: for a path, the
  path in content-bearing output (Read, `rg -n`, a diff), not a listing; for a
  test claim, a runner summary line at or after the last write.
- Numbers in commit messages before `9f92298` used an earlier scorer that
  charged every unconfirmed flag as fp. They are not comparable to these.

## Trajectory

| commit | policy | V | blocks | V, last 7d | blocks, last 7d |
|---|---|---|---|---|---|
| `5ecfd68` | manifest-membership path check, slash required, absence on | 170.8 | 14.8% | 49.7 | 14.4% |
| `9f92298` | on-disk existence check, bare filenames allowed, absence off | **409.2** | 20.9% | **117.2** | 18.3% |
| oracle | every confirmable catch, nothing else | 564.5 | 20.7% | | |
| no gate | | 0.0 | 0% | | |

Per class at `9f92298`:

| class | catch | fp | unknown |
|---|---|---|---|
| path-missing | 636 | 263 (all staleness) | 0 |
| url | 126 | 24 | 86 |
| command-outcome | 104 | 0 | 9 |

## The gap to the oracle, 155.3

| lever | gain | cost | verdict |
|---|---|---|---|
| re-enable the manifest path check | +73 catches | 179 more blocked turns, 572 ungradable flags; V 395.5 | not at β2=0.25 |
| version class | +57 | 285 fp; V 137.5 | no |
| url hosts from Bash output | +24 | untested | open |
| demote url to a non-blocking note | | blocks 18.3% → 16.2% | defensible |
| demote command-outcome | | blocks 18.3% → 14.9%, loses the class with 0 fp | no |

## What the labels cannot see

- An example path in prose (`src/x.ts:12` as a format illustration). 1.1% of
  path-missing flags. Every label, including the live `resolved`, scores it as
  a catch. The first live block was one.
- `resolved=true` means the span did not come back. Rewording an example counts.
- 86 url flags have no signal either way.

## Targets once live

Precision (resolved blocks / all blocks) ≥ 0.9. Block rate ≤ 0.1. Replay puts
the first at 87-96% and the second at ~15% after discounting staleness.

## Where the data is

`~/.claude/verified/`: `ledger.jsonl` (one node per evaluated turn, ~100 KB each,
carries answer text so it stays out of git), `manifests/`, `worlds.lock.json`,
`replay-log.jsonl` (one aggregate line per replay run, safe to copy anywhere),
`offsets.json`. Live ledger at time of writing: 11 nodes, 1 block, resolved.

## Re-measure

```sh
node hooks/replay.cjs --corpus            # current config on the pinned history
node hooks/replay.cjs --corpus --sweep    # every single-knob candidate, no-regress
node hooks/replay.cjs                     # the live ledger, once it has ≥20 nodes
```
