---
name: git-commit
description: What has to be true before this commit lands.
---

# Before this commit

- For each hunk: name the observed case it fixes, the test that fails without it, and why it lives at that layer. A hunk missing one of the three is deleted or split out.
- Nothing rides along that the commit's own subject does not describe. A second thing to fix means a second branch.
- The message is the subject plus what changed and why it was needed, not a transcript of the debugging.
- Do not commit design docs, plans, specs, or scratch files unless the user explicitly asked for them to be committed.
- Commit only when the user asked for a commit. If you are on the default branch, branch first.
