# feedback

A local feedback inbox for the AI setup, exposed as an MCP server with two tools.

- `collect_feedback` records a `bug`, `pain_point`, `ambiguity`, or `idea` with a title,
  details, and optional `area`, `severity`, and `evidence`. The server also stores the time
  and the working directory it ran in.
- `read_feedback` lists entries newest first, filtered by `status` (open by default),
  `kind`, `area`, `severity`, or a text `query`.
- `update_feedback` resolves an entry, closes it as `wontfix`, reopens it, or corrects its
  fields. Updates are appended as `{ "op": "update" }` lines and merged on read, so
  concurrent sessions never overwrite each other.

A mod (`hooks/register.tsx`) adds the UI:

- `/feedback` opens a pane listing entries newest first, with a filter button per kind.
- `/fb <text>` logs a `pain_point` through `collect_feedback` without a model turn.
- Every successful `collect_feedback` call shows a toast and a card above the prompt; the
  footer counts open entries by severity.
- Feedback tool calls draw as compact rows in the transcript.

Entries go to `data/feedback.jsonl` inside this plugin, one JSON object per line. The
folder is git-ignored. The server is plain Node with no dependencies.

Test: `node --test claude/plugins/feedback/server/feedback-mcp.test.cjs` and
`claude plugin test claude/plugins/feedback`.
