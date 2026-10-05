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
| `69ca1d7` | quote test by parity, not adjacency | 398.8 | 20.6% | | |
| this commit | a span after an example marker (e.g., named, called) is a mention | **396.9** | 20.6% | | |
| oracle | every confirmable catch, nothing else | 552.8 | 20.4% | | |
| no gate | | 0.0 | 0% | | |

The mention rule is the one change shipped against the replay rather than
because of it: V and the oracle fall together, 409.2 to 398.8 against 564.5 to
552.8, because the scorer had the same blind spot as the policy and was
crediting mentioned spans as catches. Share of the ceiling is flat at 72%. All
18 corpus flags the rule drops were read by hand and every one is a mention: a
phrase quoted from an earlier block, a JSON key quoted out of a config file, a
filename inside a quoted error message. None was a claim, so none was a catch.

The example-marker rule scores identical to its parent (396.9 on both sides;
the same config measures 396.9 today on 3253 of the 3260 pinned turns) because
no replayed answer ever wrote `e.g.` before a path. It ships as a convention for
the model, taught in the block message, not as a measured gain: six live blocks
in one session were on a well-known filename used as a concept.

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
| url hosts from Bash output | shipped 97ade34 | V 398.1 → 371.6, labeller blind spot (README) | overridden |
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

As of 2026-09-30 the live ledger holds 3079 nodes and 466 blocked turns (15.1%).
Score it with `node hooks/replay.cjs`.

A block used to count as a catch whenever the flagged span didn't come back.
But 450 of 582 path blocks came back with the file deleted from the answer,
not corrected. The labeller now reads the rewrite (`truthLabel` in
`hooks/labels.cjs`): a path block is a catch if the rewrite still names the
file, a false positive if it dropped a real file, and unknown otherwise. A
file counts as real if the repo tracks it, the session touched it, or any tool
printed its name, subagent transcripts included. Without the tool-output check,
a real file outside the repo looked the same as a made-up one.

| scorer | V | path-missing catch / fp / unknown |
|---|---|---|
| span-gone counts as a catch | 456.7 | 562 / 72 / 0 |
| rewrite must keep the file (repo + touched files) | -49.1 | 203 / 213 / 239 |
| ... plus names seen in tool output | -279.7 | 202 / 443 / 10 |

The gate now skips a file name or URL some tool already printed, and reads a
subagent's own transcript on SubagentStop. The labeller treats a url block the
same way as a path block: a catch only if the rewrite keeps the link.

| gate, same labeller | V | blocked turns |
|---|---|---|
| before the printed-name skip | -30.8 | 141 (4.6%) |
| skip printed file names and URLs | **21.9** | 118 (3.8%) |

Path-missing alone went from -278.7 to 70.2 when the skip covered only files.

Live, path-missing blocks drop a real file about twice as often as they catch a wrong one. Most of the
dropped real files sit where the resolver doesn't look: `~/.claude` (RTK.md,
memory notes), gitignored `.orchestration` epics, and sibling repos. None of
the 10 still unknown is clearly made up: temp scripts written by heredoc, an
elided `...Factory.cs`, a file fetched from GitHub, a regex fragment.

## Held-out split (2026-10-05)

Sessions now split about 70/30 by a hash of the session id (`hooks/split.cjs`).
The pinned corpus replays 2242 turns from 316 sessions today, out of 596 pinned
worlds: the rest of the transcripts are gone from disk.

| source | train V | test V | test 95% CI |
|---|---|---|---|
| corpus | 180.4 (201 sessions) | 117.2 (115 sessions) | 53.0 to 192.2 |

Re-scoring the last eight claim-pattern commits, each against its parent, under
today's labeller: five come out `REJECT` on corpus and five on the live ledger.
Only the printed-name skip (`94471eb`) clears the new rule with a real gain:
ledger train +368.6 and test +65.3, interval 20.5 to 120.3. Every rejected case
moved fewer than 10 sessions on a side, and three moved none on test. That says more about the labeller than the split, as the next
table shows.

## Labeller agreement (2026-10-05)

50 live blocks from train sessions (`hooks/gold.cjs`), labelled by hand. These
are draft labels from a model reading each case, not yet confirmed by a person.

| class | agree |
|---|---|
| path-missing | 24/25 (96%) |
| url | 11/15 (73%) |
| command-outcome | 4/10 (40%) |
| all | 39/50 (78%) |

The labeller calls 5 blocks a catch that the hand labels call wrong. On
command-outcome, `truthLabel` scores every resolved block a catch, so it can't
tell a missing test run from a mention ("checks for 'the tests pass' with no
test run"), from a subagent's result that was reported as such, or from a recap
of an earlier step.

## Path-missing as a note (2026-10-05)

| | blocks | V | path catch / fp |
|---|---|---|---|
| ledger, path blocks | 221 of 4202 | 69.3 | 116.8 / 56.2 |
| ledger, path notes | 85 of 4202 | 42.8 | 0 / 0 |
| corpus, path blocks | 523 of 2242 | 297.5 | |
| corpus, path notes | 160 of 2242 | 92.0 | |

The split rule says `REJECT` on both sources, and the change shipped as an override (README). The 116.8 ledger catches split into 5.0 from blocks with a recorded outcome (against 26.0 wrong blocks) and 111.8 from the fixed per-flag credit.

## Targets once live

Precision (resolved blocks / all blocks) ≥ 0.9. Block rate ≤ 0.1. Replay puts
the first at 87-96% and the second at ~15% after discounting staleness.

## Where the data is

`~/.claude/verified/`: `ledger.jsonl` (one node per evaluated turn, ~100 KB each,
carries answer text so it stays out of git), `manifests/`, `worlds.lock.json`,
`replay-log.jsonl` (one aggregate line per replay run, safe to copy anywhere),
`offsets.json`.

## Re-measure

```sh
node hooks/replay.cjs --corpus            # current config on the pinned history
node hooks/replay.cjs --corpus --sweep    # every single-knob candidate, no-regress
node hooks/replay.cjs                     # the live ledger, once it has ≥20 nodes
```
