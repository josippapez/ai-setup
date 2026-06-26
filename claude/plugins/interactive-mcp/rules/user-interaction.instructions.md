---
applyTo: '**'
name: user-interaction-instructions
description: Instructions for interacting, prompting general communication, and asking questions using the built-in questions tool.
---

Use this file as a strict policy. Do not interpret these rules loosely.

## Mandatory tool usage

- Use the **built-in questions tool** (the harness-provided question/ask-question tool) for ALL interactive communication. It is the only prompting path — never use any other prompt mechanism (custom prompt servers, plain-text prompts, ad-hoc tools).
- Never send a plain-text-only user-facing reply when a prompt trigger applies; include a built-in-questions-tool prompt in that same turn.
- Never exit the prompt loop until the user sends an exact stop phrase — even if they are unresponsive or keep replying empty.

## When you MUST prompt

Ask via the built-in questions tool in every one of these cases:

1. Before any task (even when requirements look clear), to confirm scope.
2. After any task delivery, to run the satisfaction check.
3. Any ambiguity, competing approaches, or a design/behavior decision to confirm.
4. The user asks to be prompted, asks a (reply) question, or offers suggestions.
5. A requested command was skipped, or instructions conflict mid-implementation.
6. Immediately before any final/closing handoff.
7. Any unexpected situation that needs user input.
8. When replying after a system notification with task output/handoff — notifications never excuse skipping a prompt.

If a required prompt was missed in the previous turn, begin the next turn with a corrective prompt before any other work.

## Mandatory satisfaction check

After each task, ask exactly (never as plain text, never skipped, never inferred):

`Are you satisfied with this result, or would you like any changes?`

A satisfaction confirmation (`Satisfied`, `Looks good`, `LGTM`, `Thanks`) is NOT a stop phrase — keep prompting.

## Follow-up continuity

Any follow-up that is not an exact stop phrase keeps the session active — complete the work and continue the loop, re-running the satisfaction check after each follow-up (including "explain", "show diff", or brief clarifications).

## Session stop phrases

Continue the loop until the user sends one of these exact phrases (do not infer from similar wording):

1. `Stop prompting`
2. `End session`
3. `Don't ask anymore`
4. `Close conversation`

## Skipped command handling

If the user skips a requested command/script: (1) ask why, then (2) ask whether to continue with alternatives or stop.

## Empty response / timeout

- On timeout, empty, declined, or failed prompt, re-prompt indefinitely with a shorter, option-driven question. Never fall back to plain-text completion.
- Never proceed on assumptions while required input is missing.

## Prompt quality

- Short, specific, decision-oriented; include predefined options when practical; never ask for secrets or credentials.

## Prompt-loop todo

Maintain one persistent todo titled `Interactively Prompt user after [current task]`:

- Task start: `pending`. After sending the satisfaction prompt: `in_progress`. On any non-stop reply: back to `pending`.
- Mark it `completed` ONLY on an exact stop phrase.
