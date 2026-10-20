# scope

A Stop hook that makes the answer name every file the turn changed.

`hooks/scope.cjs snapshot` runs on `UserPromptSubmit` and records `HEAD` plus a content hash of every modified or untracked file under the prompt's `cwd`. `hooks/scope.cjs check` runs on `Stop`, takes the same snapshot again, and lists the files whose content changed in between, including files committed during the turn. A file counts as named when its path, its basename, or one of its directories appears in the prompt or in the answer. If any changed file is named by neither, the hook blocks once with the list and asks for a reason next to each path, or a revert. A turn already continued by a Stop hook (`stop_hook_active`) is let through, so it cannot loop.

A prompt sent mid-turn adds its text to the turn's snapshot instead of replacing it. A snapshot older than an hour is from a turn whose Stop never fired and is replaced.

Every check appends a row to `$CLAUDE_PLUGIN_DATA/ledger.jsonl` with the changed and unnamed files and the action, so the block rate can be audited.

What it does not do: judge whether a named change was needed. That is the reader's call once the sentence exists. Hunks inside a named file are not checked.

## Tests

```sh
node --test claude/plugins/scope/hooks/scope.test.cjs
```
