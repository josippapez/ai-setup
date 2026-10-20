# journal

Keeps a record of what each turn changed, written by hooks so it never depends on the main model remembering. It knows no issue tracker: a tracker gets each entry through an optional sink command.

- **`snapshot`** (`UserPromptSubmit`): records `HEAD` and a content hash of every modified or untracked file in the repo. A prompt sent mid-turn adds its text to the turn's snapshot, and snapshots older than a day (a turn whose end never arrived) are swept.
- **`record`** (`Stop`, async, so the turn never waits): diffs against the snapshot, skips lockfiles, describes up to 8 changed files in one line each, and finds the commits the turn made (new since the prompt, by this repo's git user, committed after the prompt, so a `git pull` brings none in). It appends `{ ts, session, prompt, files, more?, commits? }` to `$CLAUDE_PLUGIN_DATA/journal/<repo>.jsonl`, then hands the entry to the sink.
- **`inject`** (`SessionStart`): adds the last 3 entries for the repo to the session's context, marked as data from a small local model.
- **`build`** (`SessionStart`, async): compiles `hooks/describe.swift` into the data dir with `swiftc` when its source changes.

## Sink

Configured outside this repo, in `~/.config/journal/sink.json`, usually written by the tracker itself when it installs:

```json
{ "command": ["/path/to/tracker-command", "arg"] }
```

After every turn that changed files or made commits, the command gets one JSON object on stdin and its output is ignored:

```json
{ "session_id": "...", "cwd": "/abs/repo", "agent": "claude-code", "started": "2026-10-20T14:02:11.000Z", "prompt": "first 200 chars",
  "files": [{ "path": "src/a.ts", "what": "adds the X type" }], "more": 3, "commits": ["abc123def456"] }
```

`agent` is `claude-code` or `opencode`. `started` is when the turn's first prompt arrived. The command runs as a child of the agent's process, so a tracker can tell which terminal and session it came from. No config, no sink; the journal works the same.

## Descriptions

They come from Apple's on-device model (free, no download, 1 to 3 s a file). It only describes, and the injected text says it can be wrong, because it is: measured on this setup it labels a diff well when it gets the changed lines, but zero-shot it can't hold a yes/no verdict (see `claude/plugins/scope/README.md`), and given an empty diff it invents one. So it sees only `--unified=0` changed lines, capped at 1,500 characters for its 4,096-token context, never a binary, empty or deleted file, and is told when a file is new. Files that look like secrets (`.env*`, `*.pem`, `*.key`, `id_*`, `.npmrc`, names with secret, credential, token or password) get line counts only, so a value can't be quoted into a later session's context. Without the model (no `swiftc`, not macOS, model unavailable) each line is `changed (+N -M)`.

## OpenCode

`opencode/plugins/journal` runs a copy of `hooks/journal.cjs` and `hooks/describe.swift` (`journal-sync.test.cjs` fails when they drift): the `prompt` hook snapshots, the end of a turn (`session.execution.succeeded`, `.failed` or `.interrupted`; OpenCode 2.x declares `session.idle` but never sends it) records, and the `context` hook adds the last entries once per session. Its data lives in `~/.config/opencode/journal`.

## Tests

```sh
node --test claude/plugins/journal/hooks/journal.test.cjs opencode/plugins/journal/journal-sync.test.cjs
```

The tests point the sink config at a temp file, so they never hand entries to a real tracker.
