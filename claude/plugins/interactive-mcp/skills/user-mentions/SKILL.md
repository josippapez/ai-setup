---
name: user-mentions
description: 'Re-open every file the user referenced before editing code or generators, so the edit reflects the file current content rather than an earlier read.'
when_to_use: 'Triggers: any prompt with an @-mentioned or pasted file path, "this file", "that component", "the one I mentioned", "as shown in <path>", "I updated it", "I changed that file". Use before the first edit of a turn whenever the user pointed at a specific file, including files already read earlier in the session, and open the matching generator templates when generators mirror them.'
---

# user-mentions

When a user points to specific files, instructions or skill, or says they updated them, re-read them (and their generator counterparts, if any) before making changes that affect those files.

## Best practices

- Open the mentioned files to mirror their current state; if generators mirror them, open the matching templates under tools/nx-plugin/ and update both.
- If a referenced file cannot be found, search the workspace or ask the user for the correct path before proceeding.

## References

- [agent-guidance-authoring](../agent-guidance-authoring/SKILL.md) for how to update skills, instructions, and docs when patterns change
- [workspace-hygiene](../workspace-hygiene/SKILL.md) for keeping the repo clean and up to date after changes
- Ask the user directly when a mention is ambiguous or a confirmation is genuinely needed.
- [docs-upkeep](../docs-upkeep/SKILL.md) for how to maintain the accuracy and relevance of documentation when code changes
- [patterns](../patterns/SKILL.md) for how to follow and update established patterns in the codebase when making changes
- [design-system](../design-system/SKILL.md) for how to maintain consistency in UI components and styles when updating code that affects the frontend
