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

## Live audit and the scorer (2026-10-19)

Every block of 2026-10-08..19 read by hand: 49 blocks in 7570 turns, about 8 right. All 48 with a
recorded outcome scored `resolved`, because the model always rewrites. Causes: 13 compaction or
away summaries judged with an empty manifest, about 15 prose, version-bump or outside-project
writes via Bash aging a run, 12 links the session had made with `az` or `gh`, 4 URLs in code spans.
verified 0.2.7 fixes those four. Same data, old vs new config:

| source | blocks | V | fp |
|---|---|---|---|
| corpus, 3082 turns from 1370 worlds, old | 157 (5.1%) | 74.8 | 17 |
| corpus, same, new | 98 (3.2%) | 70.5 | 9 |

V falls because the labeller credited the removed blocks as catches. `truthLabel` now scores an
outcome block as a catch only when the rewrite's manifest holds a check run after the block, and a
url block only when the host was fetched after it; a kept link without a fetch, and a block issued on
an empty manifest, are false positives. Hand-label agreement 76% to 80% (command-outcome 40% to 50%,
url 73% to 80%). Under this scorer the live ledger (12719 nodes) reads V -49.0 new vs -50.8 old,
command-outcome 45 catch / 85 fp on both, because a ledger node stores its `lastWrite` and so cannot
see the write-detection change. The ledger read is now chunked: `readFileSync` threw at 718 MB and
every replay had been scoring zero nodes.

Of the 24 live blocks the new gate would still issue, 5 were outcome claims the sentence itself
disowned: attributed to a subagent, "I haven't checked", or a question. verified 0.2.8 treats those
as non-claims; corpus replay drops exactly those 5 flags (98 to 93 blocks, V 70.5 to 66.8 because the
corpus labeller credits them). Six local models read the same 19 sentences with an instruction written
from those patterns:

| model | agrees with hand labels | lifts a real claim | per call |
|---|---|---|---|
| Apple on-device (FoundationModels) | 16/19 | 0 | 1.0 s |
| gemma3n:e4b | 17/19 | 0 | 4.4 s, 21 s cold, 7.5 GB |
| llama3.2:3b | 16/19 | 1 | 1.3 s |
| gemma3:4b | 16/19 | 1 | 2.1 s |
| qwen2.5:3b | 10/19 | 8 | 0.6 s |
| qwen3:4b, gemma3:1b | 8/19, 5/19 | | |

None lifted the two subagent-attributed blocks the regex lifts, so the regex ships and no model runs.

## Baseline after the rewrite-pairing fix (2026-10-21)

`7d79f4a` pairs a block with the next answer on its own thread, not the session's next ledger
node: prompt suggestions and progress lines logged in between had been graded as the rewrite. That
alone moved ledger V from -38.75 to -10.75, so compare later changes against these rows, not the
ones above. Same config as 0.2.8.

| source | V | blocks | train V | test V (95% CI) | outcome catch / fp | url catch / fp / unknown |
|---|---|---|---|---|---|---|
| ledger, 12971 nodes | -8.5 | 174 (1.3%) | -18.8 | 10.3 (-3.8 to 26.5) | 63 / 67 | 44 / 5 / 47 |
| corpus, 3082 turns, 1370 worlds | 66.8 | 93 (3.0%) | 47.8 | 19.0 (5.3 to 38.0) | 56 / 0 | 43 / 9 / 15 |

- Hand labels, now all 50 confirmed by a person: the labeller agrees on 40 (80%): path-missing
  23/25, url 12/15, command-outcome 5/10.
- Clean set (`hooks/clean.cjs`, 39 claims a person confirmed fine): the current config still blocks
  4, 3 urls and a "build passed" recap.
- What the rewrite did (`hooks/outcomes.cjs`, 70 blocked claims since 2026-10-08): 31 ran the check,
  1 kept the claim, 22 dropped it, 16 hit a summary with no manifest. Running the check is not the
  same as the block being right: a model re-runs a test just to get past the gate.

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
