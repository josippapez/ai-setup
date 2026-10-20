# scope

A Stop hook that shows which files the turn changed without the answer naming them.

`hooks/scope.cjs snapshot` runs on `UserPromptSubmit` and records `HEAD` plus a content hash of every modified or untracked file under the prompt's `cwd`. `hooks/scope.cjs check` runs on `Stop`, takes the same snapshot again, and lists the files whose content changed in between, including files committed during the turn. A file counts as named when its path, its basename, or one of its directories written as a directory (`src/`) appears in the prompt or in the answer. Lockfiles and diffs that only change version numbers are skipped. What is left is shown to the person as one line, `scope: changed but not named: a.ts, b.ts`, and the turn ends as normal.

It does not block. The first version did, asking the model to explain each unnamed file: across two sessions every block landed on in-scope work the answer had described in prose (a feature's own files, a release's version bump), and none pointed at a ride-along. Apple's on-device model, tried as a judge on those cases plus five planted ride-alongs, answered YES to all 13 files, so there is no cheap judge to put in front of the person. The list is the deterministic fact; the judgement stays with the reader.

A prompt sent mid-turn adds its text to the turn's snapshot instead of replacing it. A snapshot older than an hour is from a turn whose Stop never fired and is replaced.

Every check appends a row to `$CLAUDE_PLUGIN_DATA/ledger.jsonl` with the changed and unnamed files and the action (`pass` or `note`), so it can be audited later whether the notes ever pointed at a real ride-along.

## Tests

```sh
node --test claude/plugins/scope/hooks/scope.test.cjs
```
