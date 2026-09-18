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
| `9f92298` | on-disk existence check, bare filenames allowed, absence off | 409.2 | 20.9% | 117.2 | 18.3% |
| `0b88ee1` | mentioned spans are not claims | 402.6 | 20.6% | | |
| this commit | quote test by parity, not adjacency | **398.8** | 20.6% | | |
| oracle | every confirmable catch, nothing else | 552.8 | 20.4% | | |
| no gate | | 0.0 | 0% | | |

The mention rule is the one change shipped against the replay rather than
because of it: V and the oracle fall together, 409.2 to 398.8 against 564.5 to
552.8, because the scorer had the same blind spot as the policy and was
crediting mentioned spans as catches. Share of the ceiling is flat at 72%. All
18 corpus flags the rule drops were read by hand and every one is a mention: a
phrase quoted from an earlier block, a JSON key quoted out of a config file, a
filename inside a quoted error message. None was a claim, so none was a catch.

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

- `resolved=true` means the span did not come back. Rewording anything counts.
- 85 url flags have no signal either way.
- Fixed since: a span that only ever appears in quotes, and a path whose
  basename is metasyntactic, are now non-claims for both the policy and the
  scorer. A bare single letter was in the first draft of that rule and it
  excluded `lib/a.cjs`, so the list is x/y/z plus foo/bar/baz/qux/quux/example/sample.

## Live blocks so far

Four, of which two were wrong and both were the mention shape now fixed. One
asked for a full path on a file that really does sit outside the repo, which
was correct. Too few to mean anything yet; the point of the ledger is to make
this table worth reading.

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
