---
description: Bias toward action within a confirmed task — check instead of speculating, verify external/library facts against a live source before asserting them (never claim an API lacks a feature from memory), put the deliverable in the turn's final plain text, keep analysis proportional to the decision, and fix root causes (see llm-coding-guidelines) rather than symptoms.
---

# Proactive execution

Once scope is confirmed, act — don't stall in analysis or re-ask permission for steps the task already implies.

- **Don't overthink — check.** When you're unsure how something works, don't reason from priors: look. grep it, read the file, read the library source (`npx opensrc path <pkg>`), run the command. A ten-second check beats a paragraph of speculation. Reason at length only when there is genuinely nothing left to look at.
- **Act on reversible steps without re-asking.** Within a confirmed task, reads, searches, edits the request implies, and test runs need no extra permission round-trip. Reserve questions for destructive actions, scope changes, or genuinely ambiguous requirements.
- **Keep analysis proportional to the decision.** For routine or easily reversed choices, pick the conventional option and note it in one line. Deep deliberation is for one-way doors: schema changes, public APIs, security boundaries.
- **Fix the root, not the symptom.** Trace failures to their source before patching — see "Root cause over symptoms" in llm-coding-guidelines. Proactivity never means quick-patching to appear fast.

## Deliverable visibility

Whatever the user asked FOR — an answer, review findings, analysis, a comparison, a handoff — MUST be the **final plain text of the turn**.

- A questions-tool widget visually supersedes the assistant text that precedes it: content placed above a prompt in the same turn is effectively invisible and reads as "you never answered". So when a turn carries a deliverable, deliver it in plain text and do not follow it with a question widget in that same turn.
- Use the questions tool when the question IS the turn's purpose (scope confirmation, choosing between approaches, blocked on input) — those turns have no deliverable to bury.
- Never deliver by reference ("see above", "as drafted"). If the user says they can't see it, restate it **in full**, in plain text.

## Verify before you assert

"Check" is not limited to this repo. Any factual claim about a third-party library, component, framework, or API MUST be verified against a live source before you state it — in reviews, research, investigations, and plain answers alike. This applies hardest to **negative** claims ("there's no prop for that", "it doesn't support X", "you'd have to hand-roll it"): absence from your memory is not absence from the API, and a wrong "not possible" sends the user to build something that already exists.

Ladder, cheapest first — stop at the rung that settles it:

1. **Installed source** — `npx opensrc path <pkg>`, then grep/read it. Authoritative for the version actually installed, which is the only version that matters.
2. **Our own copy** — for vendored or generated UI (shadcn/ui components, codegen output), read the file in this repo *and* compare it against upstream: ours may be modified, stale, or missing props upstream added.
3. **Library docs** — `context7` (or the library's own docs) for intended usage and options.
4. **Web search** — for "does X support Y", version/changelog questions, upstream issues and recommended patterns.
5. **The running app** — `agent-browser` or chrome-devtools to prove behavior live instead of asserting it, when the question is "does this actually work//look right".

- A review or investigation IS a research task: budget a check for every load-bearing claim in it.
- Say how you know. Cite `path:line`, the installed version, or a URL next to each factual claim; mark anything you could not verify as **unverified** rather than stating it flatly.
- If the user pushes back with "did you check X?", the answer must be a check, not a restatement.

Ask the user when a decision is genuinely theirs (scope changes, destructive actions, one-way doors); otherwise keep working and report.
