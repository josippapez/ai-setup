# Close-out brief

The orchestrator's final report **to the user**. This is the one artifact a human actually reads, so it explains the work — not the machinery that produced it. It is distinct from an issue's `Handoff:` JSON, which is agent-to-agent.

Required at **every terminal outcome**: done, partial, blocked, or aborted. Render it in the reply *before* asking the landing question, and append the same text to EPIC `## Completion` so it survives the session.

## Shape

Fixed order, every part labelled, whole thing **≤40 rendered lines**. Short and dense beats complete and skimmed. Omit a part only by writing `none`.

1. **Point** — 1–2 lines: what was wrong or missing before, and what is true now that wasn't. If you cannot state this without referring to the epic's own chunk numbers, you have not found the point.
2. **Diagram** — one plain-text picture of the change (rules below).
3. **Changed** — table `Area | Change | Why`, one row per real change, ≤7 rows. Group related rows rather than silently truncating; if you drop rows, say how many.
4. **How** — 2–4 bullets on the load-bearing decisions, each with the alternative rejected and why. Not a chunk-by-chunk replay of execution.
5. **Verified** — each claim as `command → actual observed result`. Name every gate that was skipped and why. Never assert "tests pass" without the command and the count.
6. **Open** — what is left, known risk, deliberate debt, deferred docs. `none` only when genuinely none.
7. **Landing** — where the work physically is right now (uncommitted, branch, PR), then the landing question.

## Diagram rules

- **Diagram the system, not the workflow.** Before → after of dependencies, data flow, module boundaries, or state. A picture of the epic's own chunks, waves, or agents is process theatre; the user did not ask what the agents did in what order.
- **Plain text by default** — box drawing, arrows, tables. The terminal renders GFM, not mermaid, so a ` ```mermaid ` fence arrives as literal source. Use mermaid only on a surface that renders it (published artifact, web UI).
- **Real names** from the repo — files, packages, commands, counts. Never abstract placeholders.
- It must carry information the prose does not. A diagram that restates a sentence is deleted, not kept.
- One diagram. A second must earn its place. Keep it ≤14 lines and inside 80 columns.

Match the form to the change: a dependency or boundary change wants before/after boxes; a data or control flow wants a left-to-right pipeline with its decision points; a lifecycle wants state arrows; and when the change is *numbers* (counts, bytes, timings, request volume) a two-column before/after table beats any drawing.

```text
before                          after
┌──────────────┐                ┌──────────────┐
│ bin/wcag.js  │                │ bin/wcag.js  │
└──────┬───────┘                └──────┬───────┘
   requires                        imports
┌──────▼─────────────────┐      ┌──────▼───────────────┐   TTL 7d, cond. GET
│ wcag-guidelines-mcp    │      │ src/data.js          │──▶ w3.org/…/wcag.json
│ (3rd party, pinned SC) │      │ + data/ (offline)    │    304 → touch only
└────────────────────────┘      └──────────────────────┘
1 dependency · data frozen      0 dependencies · self-refreshing
```

## Anti-patterns

Replaying the chunk list. Reporting store bookkeeping. Adjectives with no measurement ("significantly improved", "robust"). Diagramming agents. Padding to look thorough. Stating a pass you did not observe — read the exit code, not the tail of the output.

State what was **not** done as plainly as what was. A brief that hides a skipped gate is worse than no brief.
