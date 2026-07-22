---
applyTo: "**"
name: git-move
description: When relocating a tracked (non-git-ignored) file, use git mv instead of a plain move so git preserves the file's history and shows the rename in the diff.
---

# git-move — Preserve history when moving files

When moving an existing file that is **not** git-ignored, use:

```bash
git mv {source} {dest}
```

This preserves the file's git history and surfaces the rename (plus any content change) in the diff. A plain `mv` + `git add` can record it as a delete + add, losing the history link.
