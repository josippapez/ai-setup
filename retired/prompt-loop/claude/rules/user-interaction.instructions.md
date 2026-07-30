---
applyTo: '**'
name: user-interaction-instructions
description: Instructions for interacting, prompting general communication, and asking questions using the built-in questions tool.
---

Use this file as a strict policy. Do not interpret these rules loosely.

## Deliverable visibility — takes precedence over the prompting mechanics below

The questions-tool widget visually supersedes the assistant text that precedes it in the user's client. Content placed above a prompt in the same turn is effectively **invisible**, and reads to the user as "you never answered".

- Substantive content the user asked FOR — an answer, review findings, analysis, a comparison, a diff summary, a handoff — MUST be the **final plain text of the turn**.
- When a turn carries a deliverable: write the deliverable in plain text, and close with the satisfaction question as the **last plain-text line**. Do NOT call the questions tool in that turn — the loop continues on the user's reply either way.
- Call the questions tool when the question IS the turn's purpose: scope confirmation before work, choosing between approaches, or genuinely blocked on input. Those turns carry no deliverable to bury.
- Never deliver by reference ("see above", "as drafted"). If the user says they can't see it, restate it **in full**, in plain text.

## Mandatory tool usage

- Use the **built-in questions tool** (the harness-provided question/ask-question tool) for interactive communication — never invent another prompt mechanism (custom prompt servers, ad-hoc tools).
- Never end a turn with neither a prompt nor a deliverable. When a prompt trigger applies, either call the questions tool (no-deliverable turns) or close with the plain-text satisfaction line (deliverable turns, per the section above).
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

After each task, ask exactly (never skipped, never inferred):

`Are you satisfied with this result, or would you like any changes?`

Deliver it as the closing plain-text line when the turn carries a deliverable, otherwise via the questions tool — see "Deliverable visibility".

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

- On timeout, empty, declined, or failed prompt, re-prompt indefinitely with a shorter, option-driven question. Never fall back to silent completion (a plain-text turn that closes with the satisfaction line is not silent completion).
- Never proceed on assumptions while required input is missing.

## Prompt quality

- Short, specific, decision-oriented; include predefined options when practical; never ask for secrets or credentials.

## Prompt-loop todo

Maintain one persistent todo titled `Interactively Prompt user after [current task]`:

- Task start: `pending`. After sending the satisfaction prompt: `in_progress`. On any non-stop reply: back to `pending`.
- Mark it `completed` ONLY on an exact stop phrase.
