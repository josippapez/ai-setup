# feedback

A local inbox for anything that could be better: pain points, slow steps, ambiguities, bugs, and work worth automating, in the project being worked on or in the AI setup. It is an MCP server with three tools.

- `collect_feedback` records a `bug`, `pain_point`, `ambiguity`, or `idea` with a title,
  details, and optional `area`, `severity`, and `evidence`. The server also stores the time
  and the working directory it ran in.
- `read_feedback` lists entries newest first, for the current project unless `project` is `all`,
  filtered by `status` (open by default),
  `kind`, `area`, `severity`, or a text `query`.
- `update_feedback` resolves an entry, closes it as `wontfix`, reopens it, or corrects its
  fields. Updates are appended as `{ "op": "update" }` lines and merged on read, so
  concurrent sessions never overwrite each other.

A mod (`hooks/register.tsx`) adds the UI:

- `/feedback` opens a pane listing this project's entries newest first, with a filter button per
  kind; `p` toggles to every project. The footer counts this project's open entries.
- `/fb <text>` logs a `pain_point` through `collect_feedback` without a model turn.
- Every successful `collect_feedback` call shows a toast and a card above the prompt; the
  footer counts open entries by severity.
- Feedback tool calls draw as compact rows in the transcript.

A UserPromptSubmit hook (`hooks/gap-nudge.cjs`) scores the agent's previous answer with a local
classifier: multilingual-e5-small embeddings (transformers.js, downloaded on first use) plus logistic
weights in `hooks/gap-model.json`. When the answer looks like it named a wrong, stale or missing doc,
skill, rule, script or config, it adds a suggestion to log it with `collect_feedback`. It nudges
about 40% of turns and catches about 60% of gaps on projects it was not trained on; a false alarm
costs one ignored line. The SessionStart hook installs `@huggingface/transformers` into the plugin
data dir.

Entries go to `data/feedback.jsonl` inside this plugin, one JSON object per line. The
folder is git-ignored. The server is plain Node with no dependencies.

Test: `node --test claude/plugins/feedback/server/feedback-mcp.test.cjs claude/plugins/feedback/hooks/gap-nudge.test.cjs` and
`claude plugin test claude/plugins/feedback`.
