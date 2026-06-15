---
name: prompt-user
description: Run user-facing prompt loops with the built-in questions tool for scope confirmation, decision collection, and mandatory post-delivery satisfaction checks.
---

# prompt-user

Use this skill for any user-facing prompt workflow.

- [./interactive-prompt-loop.instructions.md](./interactive-prompt-loop.instructions.md)

## Required behavior

1. Use the **built-in questions tool** (harness-provided `question` / `ask_question` / equivalent) for every prompt.
1. Before starting each newly requested task in an active session, ask at least one scope/confirmation prompt.
1. After any task output/delivery, ask exactly:
   `Are you satisfied with this result, or would you like any changes?`
1. Prompting MUST stop only on these exact phrases:
   - `Stop prompting`
   - `End session`
   - `Don't ask anymore`
   - `Close conversation`
1. Any non-stop outcome MUST continue the active loop and trigger re-prompting:
   - non-stop user replies (including acknowledgements and new task requests)
   - prompt timeout or empty response
   - prompt decline/cancel/dismiss
   - prompt tool failure
1. Plain-text completion fallback is forbidden — re-prompt with a shorter, option-driven question instead.
1. If implementation is still pending (report/diff checkpoint only), ask whether to implement next and keep prompting.
1. After system-notification-driven outputs, include the mandatory satisfaction prompt again.
1. Maintain one persistent prompt-loop todo titled `Interactively Prompt user after [current task]`; keep it active across task cycles and only complete it on an exact stop phrase.

## Trigger cases

- Task start, ambiguity, competing options, conflicts, skipped commands, and post-notification outputs.
- Any situation defined in [./interactive-prompt-loop.instructions.md](./interactive-prompt-loop.instructions.md).

## Prompt quality

- Keep prompts concise and action-oriented.
- Include predefined options whenever practical.
- Never ask for secrets or unnecessary personal data.

## Prompt-loop todo pattern

- At task start: create/keep `Interactively Prompt user after [current task]` as `pending`.
- After sending the satisfaction prompt: set it to `in_progress`.
- On any non-stop user reply: reset it to `pending` for the next task.
- On exact stop phrase only: mark it `completed`.
