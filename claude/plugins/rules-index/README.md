# rules-index

One SessionStart hook. It lists the rule files Claude Code loads for the session, from the project's `.claude/rules/` and the user's `~/.claude/rules/`, as a `[rules-index]` block: one line per file with its path, `name`/`description` frontmatter when present, and its `paths` globs.

Why: rules without `paths:` are already in context, but path-scoped rules only enter context when Claude reads a matching file. At session start, and again after compaction, the model does not know they exist. The index tells it which rule to read before working in an area.

- Fires on every SessionStart source (startup, resume, clear, compact).
- Stays under Claude Code's 10,000-character hook output cap; past 9,000 characters it drops trailing lines and says how many were left out.
- Rules with no frontmatter show as their path only.
- Not applied: `claudeMdExcludes`. An excluded rule still appears in the index.

## Tests

```bash
node --test claude/plugins/rules-index/hooks/inject-rules-index.test.cjs
```
