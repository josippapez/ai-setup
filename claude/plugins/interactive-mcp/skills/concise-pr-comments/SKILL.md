---
name: concise-pr-comments
description: Write short, human PR review comments. Use when drafting or posting inline code review comments, especially when the user asks for concise, to-the-point, human-like comments. Triggers include "leave inline comments", "draft review comments", "make it short", "human like", and "PR comments".
---

# Concise PR Comments

Use this skill when drafting or posting PR review comments.

## Style

Write like a senior dev dropping a quick note for a teammate, not like an automated policy engine.

- Keep it short. One or two sentences for most comments.
- Casual is good: contractions, plain words, get to the point.
- State the concrete issue plainly. Drop the corporate hedging ("this appears to potentially introduce a risk that may...").
- Use a "nit:" prefix for minor or optional stuff so the author knows it's not a blocker.
- Ask a direct question when you actually want the author to make the call ("why skip instead of fail here?"). Don't bolt on a forced suggestion when the issue already speaks for itself.
- Save the long explanation for when the user asks for detail.
- No em dashes. Use a comma, a period, or just split the sentence. People typing fast in a PR almost never reach for one, so it reads as bot-written.

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
