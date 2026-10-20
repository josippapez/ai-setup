# journal

Keeps a record of what each turn changed, written by hooks so it never depends on the main model remembering.

- **`snapshot`** (`UserPromptSubmit`): records `HEAD` and a content hash of every modified or untracked file in the repo. A prompt sent mid-turn adds its text to the turn's snapshot.
- **`record`** (`Stop`, async, so the turn never waits): diffs against the snapshot, skips lockfiles, and describes up to 8 changed files in one line each. It appends `{ ts, session, prompt, files }` to `$CLAUDE_PLUGIN_DATA/journal/<repo>.jsonl`. Inside a Wings pane it also calls `tasks__log` on the session's open issue (In progress or In review, the one this session touched last), through the same `wings --mcp` bridge Claude Code uses, so Wings attributes the note to this session. No open issue, no note.
- **Commit links** (in `record`): every commit the turn made is added to the session's open issue with `tasks__update commit=<hash>`. A turn's commits are the ones reachable from the new `HEAD` and not the old one, by this repo's git user, committed after the prompt, so a `git pull` brings none in. Issues adds a commit only once, so one the model already linked is a no-op.
- **`inject`** (`SessionStart`): adds the last 3 entries for the repo to the session's context. Inside Wings it also lists open issues to check: one In progress or In review with no change for 3 days, and this session's issue when every step of its todo is done but it is still open. It only reports these. Changing a status is a verdict, which the on-device model gets wrong, so it stays with the main model or the person.
- **`build`** (`SessionStart`, async): compiles `hooks/describe.swift` into the data dir with `swiftc` when its source changes.

The descriptions come from Apple's on-device model (free, no download, 1 to 3 s a file). It only describes, and the note says the lines come from the diff, because it is wrong often enough to need checking: measured on this setup it labels a diff well when it gets the changed lines, but zero-shot it can't hold a yes/no verdict (see `claude/plugins/scope/README.md`), and given an empty diff it invents one. So it sees only `--unified=0` changed lines, capped at 1,500 characters for its 4,096-token context, never a binary or empty diff, and is told when a file is new. Without the model (no `swiftc`, not macOS, model unavailable) each line is `changed (+N -M)`.

## Tests

```sh
node --test claude/plugins/journal/hooks/journal.test.cjs
```

The tests run without `WINGS_PANE_ID`, so they never write to the real issue tracker.
