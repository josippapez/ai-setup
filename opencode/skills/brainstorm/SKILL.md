---
name: brainstorm
description: Pin down what to build and how, through one-question-at-a-time dialogue, before any tracking, decomposition, or code. Use when a request describes an outcome you have not yet nailed down — a new capability, an unclear data source or output shape, a "build me X" with no defined format, or a choice between real approaches. Run this before Gate/Intake in the orchestrate skill whenever the outcome/approach is undefined; skip it when the outcome is already clear and only scope/AC details are missing.
---

# Brainstorm

Turn an idea into an approved outcome and approach through short, direct dialogue — before orchestrate tracks, decomposes, or builds anything. This is the step before Gate/Intake, not a replacement for it: brainstorm settles *what* and *how*; Intake then pins scope, ACs, and constraints for tracking.

## Hard gate

Do not track an epic, decompose it, spawn a builder, or write any code until you have stated the outcome and approach in plain language and the user has said yes to it. This holds for every request on both paths below — the ceremony scales with the task, the approval never does.

## Two paths

Classify out loud before your first question — "this is small and mostly clear, so I'll confirm the outcome and move on" or "the approach itself is open, so let's work through options" — so the user can override it:

- **Quick call** — the outcome is basically already stated; one or two questions close the remaining gaps (a missing format, a missing target). State the outcome in 1-3 sentences, get a yes, then hand straight to Gate/Intake. No options to weigh.
- **Explore** — the outcome or the approach is genuinely open: a new capability with no defined data source or output shape, a task where several real approaches exist, or a request that names a goal without saying how to get there. Ask one question at a time (multiple-choice when it fits), propose 2-3 approaches with trade-offs and a recommendation, present the resulting outcome + approach, and stop for approval.

When in doubt between the two, take Explore. Nothing downgrades mid-conversation: if a "quick call" turns out to hide a real design choice, say so and switch to Explore.

## Anti-patterns

| Thought | Reality |
|---|---|
| "This is simple, I don't need to check" | Simple shortens the dialogue, it doesn't skip the approval. State the outcome in a sentence and get the yes. |
| "I already know this kind of task" | Familiarity with the domain isn't the same as this request having a defined outcome. If the data source, shape, or approach isn't stated, it's still open. |
| "I'll just start and show them the approach as I go" | The gate is the approval before action, not a running commentary. Present, then wait. |
| "They said 'use orchestration to speed this up'" | A user naming a tool doesn't waive discovery — orchestrate executes an already-decided plan; if the plan isn't decided, brainstorm first, then hand off. |
| "It grew bigger than I thought, but I'm partway through" | Re-classify now. Hidden scope is a reason to stop and say so, not a reason to keep going quietly. |

## Process

**Understand:**
- Skim what already exists (recent commits, relevant files/docs) if it bears on the answer — don't reach for repo-docs or broad exploration before you know what question it needs to answer.
- Ask questions one at a time. Prefer multiple choice; open-ended is fine when there's no natural set of options.
- Focus each question on purpose, constraints, or success criteria — not implementation detail yet.

**Explore approaches (Explore path only):**
- Propose 2-3 approaches with real trade-offs, not a strawman next to the intended pick.
- Lead with the one you recommend and say why.
- Cut speculative scope from every approach before presenting it — describe the smallest version that satisfies the stated purpose.

**Present and approve:**
- State the outcome (what exists when this is done) and the approach (how you'll get there) in plain language, sized to the decision — a paragraph for a quick call, a few short sections for Explore.
- Ask if it looks right. Wait for an explicit yes before doing anything else.

## After approval

The approved outcome and approach become the input to Gate/Intake in the `orchestrate` skill — fold them directly into the pinned spec (objective, constraints, initial scope). Do not write a separate design document: once tracking starts, `EPIC.md` is the durable spec, and Intake's own grilling still runs for any scope/AC/constraint gaps brainstorm didn't need to touch. If the approved work turns out too small to track, say so and build it directly instead of forcing it through orchestrate.
