# verified

A Stop hook that blocks an answer when it claims something the session never checked. The dev-core rules already say "no claim without a `file:line`, a command output, or a fetched URL". This plugin is the part that enforces it. Before it existed, every correctness mechanism in the repo was advice given before the model acted, and nothing looked at the answer.

It exists for two failures the user reported: answers asserting things nobody checked, and steps skipped mid-task (a "tests pass" with no test run).

## What blocks

The hook reads the session transcript, builds a list of what actually ran, and matches the answer against it. Each claim class is on or off in `CONFIG` in `hooks/claim-patterns.cjs`.

| Class | Fires on | Backed by | State |
|---|---|---|---|
| `path-missing` | a file path | a tool having printed the file's name this session, or the file existing on this machine: from cwd, the git root, the tracked-file list, or the repo of any folder the answer names by `~/` or `/` path | note: shown to you, never sent back (`pathMissingBlocks: false`) |
| `command-outcome` | "tests pass", "build succeeds", "it works" | a clean test/build/lint run after the last file write | on |
| `url` | a cited URL | a tool having printed that URL, WebFetch or WebSearch of that host, or an `agent-browser`, `curl` or `wget` command naming it | on |
| `path` | a file path | a Read/Edit/codegraph of it | off |
| `version` | `v1.2`, `1.2.3`, "version 4" | find_libs, a manifest read, opensrc | off |
| `absence` | "there is no X" | a Grep/Glob/rg/codegraph search | off |

Guesses stay legal. The gate checks labelling, not certainty: "I'd use Postgres" passes, and "Postgres handles this natively" blocks unless something was fetched. A span in "double quotes" or after "e.g." counts as a mention, not a claim. A path-missing block asks the model to correct the path, not delete it. After 3 blocks on the same claims, the hook stops blocking and tells the model to mark them unverified.

`SubagentStop` runs the same checks on subagent answers, against the subagent's own transcript.

## Where the data is

`~/.claude/verified/`, deliberately outside the plugin data dir so a reinstall never wipes it. It holds `ledger.jsonl` (one node per evaluated turn, with answer text, so it never goes in git), `manifests/`, `worlds.lock.json` (the pinned replay history), `replay-log.jsonl`, `offsets.json` and `sessions/` (each session's last verdict and recent blocks, so the Stop hook never reads the ledger). A block's resolution is appended to the ledger as an `{ "op": "resolve" }` line and merged on read.

## Changing it

Any change to what gets flagged is scored before it ships. `/verified-replay` replays a candidate config over the pinned history of real sessions, with no model calls and nothing re-run:

```sh
node hooks/replay.cjs --corpus            # current config on the pinned history
node hooks/replay.cjs --corpus --sweep    # every single-knob candidate
node hooks/replay.cjs --candidate <file>  # a forked claim-patterns.cjs vs current
```

The score is `V = catches − false positives − 0.25 × blocked turns`. Sessions are split by a hash of their id, about 70% train and 30% held-out test (`hooks/split.cjs`), and every run prints V on each side with a 95% bootstrap interval over test sessions. A candidate gets one verdict:

| Verdict | When |
|---|---|
| `REJECT` | V drops on train or on test |
| `SHIP` | no session scores differently, or both sides gain and the test gain's interval stays above zero |
| `OVERFIT` | train gains and test stays flat, including when no test session is affected |
| `NOISE` | test gains, but its interval reaches zero |

Only read flags from train sessions when you design a rule. Reading test flags spends the held-out set. `--sweep` ranks candidates by train V for the same reason. This follows Dream-RSI (dream-rsi.com): the recorded history works as an exact simulator, the scorer (`hooks/labels.cjs`) stays fixed, and the current config is always one of the candidates. Don't tune `labels.cjs` to make a favoured config win. Change it only when you've looked at a labelled flag and shown it wrong.

### Checking the labeller

`hooks/gold.cjs` checks the labeller against hand labels on real live blocks, drawn from train sessions only:

```sh
node hooks/gold.cjs --sample 50   # draw blocks into ~/.claude/verified/gold.json
node hooks/gold.cjs --page        # write ~/.claude/verified/gold-review.html to label them
node hooks/gold.cjs --agreement   # labeller vs the hand labels, per class
```

The page preselects each draft label. Change any you disagree with, download the file, and save it over `gold.json`. Both files carry answer text, so they stay in `~/.claude/verified/`.

Scores per commit, the scorer's blind spots and the gap to the best possible score are in `RESULTS.md`.

### Known labeller blind spot, and the overrides

A fix that only removes wrong blocks can lower V, because the labeller credited those blocks as catches:

- **path-missing:** every flag gets the same fixed catch credit, with nothing to tell a real miss from a wrong block. Removing any path-missing flag costs V.
- **url:** a flag counts as a catch when the host gets fetched later in the session. Before Bash fetches counted, a page read with agent-browser and WebFetched later scored as a catch.

On 2026-09-30 the user overrode the rule for three fixes whose removed blocks were all wrong:

| Fix | V with fix vs before |
|---|---|
| Bash `agent-browser`/`curl`/`wget` URLs count as fetched | 371.6 vs 398.1 |
| `$param` and `(group)` route folders stay part of a path | 369.8 vs 371.6 |
| A relative path is also looked up in the repos the answer names | 369.3 vs 369.8 |

On 2026-10-05 the user overrode it again to make path-missing a note. Replay rejects it (ledger V 69.3 to 42.8, corpus 297.5 to 92.0), but 111.8 of the 116.8 path catches on the ledger are the fixed credit on flags the live gate never issued. On the 49 path blocks with a recorded outcome, the score was 5 catches to 26 wrong blocks, and the hand labels in `gold.json` have 1 right block in 25. The tradeoff was taken knowingly: about 1 real catch per 25 path blocks is lost.

Overriding again needs the same evidence: every block the fix removes has to be a wrong block. Fixing the labeller so it can see these cases would end the need for overrides.

## What we tried and dropped

- **An LLM judge for everything the patterns miss.** It's still in `judge/`, off unless `VERIFIED_JUDGE_ENABLED=1`. Replayed over 476 real turns it fired on 92.5% of them, and each call took 5 to 56 seconds (median about 38) with one call in five failing. The time goes to `claude -p` starting up, not to the model, so a smaller payload doesn't help. Cost was never the issue at about $0.0017 per turn. Haiku 4.5 got 5 out of 5 on the classification probe, so quality wasn't the problem either.
- **`claude -p --bare` for the judge.** It skips hooks and plugins, but it also breaks login, and the child exits with "Not logged in". The judge uses `--settings judge/judge-settings.json` plus `--strict-mcp-config` instead, and `VERIFIED_JUDGE=1` stops the child's own Stop hook from recursing.
- **A local judge model.** Ruled out on an M1 Pro with 16 GB, where 1.1 GB was free and a 7B model needs 4 to 8 GB.
- **`path` (was the file read this session).** It caught 48 claims over 3260 turns, while blocking 202 the session had already printed. The existence check does the job without those false positives.
- **`version`.** It produced 2 catches out of 67 unresolved flags over 651 turns, the worst ratio of any class. Matching version digits can't tell whether a claim about a release is true.
- **`absence`.** It produced 66 flags over 3260 turns, and no signal ever confirmed one either way.
- **Re-enabling `path` alongside `path-missing`.** It adds 73 catches but also 179 blocked turns, which scores worse at the 0.25 block weight.
- **Demoting `command-outcome` to a note.** It would lose the only class with zero false positives.

## What we want next

- **Precision of at least 0.9 and a block rate of at most 0.1 once live.** Precision here means blocks that got fixed, divided by all blocks. Replay estimates 87 to 96% precision and about 15% block rate.
- **A mid-task step gate.** "Edited a file it never read" belongs on PreToolUse, not Stop. It's the second failure the user reported, and it needs its own false-positive data.
- **A url labeller signal,** so url fixes stop needing overrides.
- **Score changes on the live ledger** (`node hooks/replay.cjs`), not only the old-transcript corpus. Since 2026-09-30 a path block there counts as a catch only if the rewrite kept the file.
- **Auto-tuning.** Today a human proposes a config change and replay scores it. Closing that loop waits on real ledger data.
- **Open question:** should `url` become a non-blocking note? That would cut the block rate from 18.3% to 16.2%.

## Tests

```sh
node --test claude/plugins/verified/hooks/verify-stop.test.cjs
```

## Mod

`hooks/ui.tsx` shows a toast and a band above the prompt listing the flagged claims whenever the Stop hook sends an answer back, since the block reason otherwise reaches only the model. The band clears on the next prompt or on Dismiss.
