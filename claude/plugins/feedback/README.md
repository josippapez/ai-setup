# feedback

A local feedback inbox for the AI setup, exposed as an MCP server with two tools.

- `collect_feedback` records a `bug`, `pain_point`, `ambiguity`, or `idea` with a title,
  details, and optional `area`, `severity`, and `evidence`. The server also stores the time
  and the working directory it ran in.
- `read_feedback` lists entries newest first, filtered by `kind`, `area`, `severity`, or a
  text `query`.

Entries go to `data/feedback.jsonl` inside this plugin, one JSON object per line. The
folder is git-ignored. The server is plain Node with no dependencies.

Test: `node --test claude/plugins/feedback/server/feedback-mcp.test.cjs`
