---
applyTo: "**"
name: interactive-prompt-loop
description: Deterministic prompt-loop policy using the built-in questions tool.
---

<!-- Concise prompt-loop policy for the prompt-user skill. The authoritative full policy is the global `user-interaction.instructions.md` rule; if they diverge, that rule wins. -->

Stop phrases (exact match only):

- `Stop prompting`
- `End session`
- `Don't ask anymore`
- `Close conversation`

Required rules:

1. Before starting each newly requested task in an active session, you MUST ask a scope/confirmation prompt via the **built-in questions tool**.
2. After each task delivery, you MUST ask exactly:
   `Are you satisfied with this result, or would you like any changes?`
3. You MUST maintain one active todo titled `Interactively Prompt user after [current task]`.
4. You MUST keep the todo active across cycles (`pending` -> `in_progress` -> `pending`) until an exact stop phrase.
5. You MUST mark the todo completed only when an exact stop phrase is received.
6. If a prompt times out or response is empty, you MUST re-prompt via the built-in questions tool.
7. You MUST NOT use plain-text prompting when a prompt trigger applies.
