---
name: git-commit
description: What has to be true before this commit lands.
---

# Before this commit

- For each hunk: name the observed case it fixes, the test that fails without it, and why it lives at that layer. A hunk missing one of the three is deleted or split out.
- Nothing rides along that the commit's own subject does not describe. A second thing to fix means a second branch.
- The message is the subject plus what changed and why it was needed, not a transcript of the debugging.
- Do not commit design docs, plans, specs, or scratch files unless the user explicitly asked for them to be committed.
- Commit only when the user asked for a commit, on the branch that is checked out. Creating a branch or a worktree for it is the user's call: if the checkout looks wrong for this change, ask. Someone else's uncommitted changes in the tree are not a reason for one: stage only your own files by path (`git add <paths>`, never `-A` or `.`) and leave theirs as they are.
- Never pass `--no-verify` or otherwise skip the hooks unless the user asked. A slow pre-commit hook is not a reason: run the commit with `run_in_background` and wait for it.
