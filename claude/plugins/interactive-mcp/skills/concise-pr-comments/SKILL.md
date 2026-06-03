---
name: concise-pr-comments
description: Write short, human PR review comments. Use when drafting or posting inline code review comments, especially when the user asks for concise, to-the-point, human-like comments. Triggers include "leave inline comments", "draft review comments", "make it short", "human like", and "PR comments".
---

# Concise PR Comments

Use this skill when drafting or posting PR review comments.

## Style

- Keep comments short and direct.
- Sound like a human reviewer, not an automated policy engine.
- State the concrete issue in one or two sentences.
- Avoid long explanations unless the user asks for detail.
- Avoid forced suggestions when the issue is already clear.
- Prefer a focused question only when it helps the author decide the fix.

## Examples

Good:

```md
Should this fail instead of skip when the Bitrise secrets are missing? As written, the sync check silently stops enforcing if the variable group is missing or not authorized.
```

Good:

```md
This says `FE9-1` is defined in `FE-guardrails.json`, but I don't see that rule in this PR.
```

Avoid:

```md
This appears to create a configuration drift risk and may mislead future maintainers. Please either add the rule metadata or document this as standalone CI validation.
```
