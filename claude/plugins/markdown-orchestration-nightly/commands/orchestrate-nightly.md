---
description: Orchestrate a non-trivial task with the experimental nightly workflow — build-only workers on the cheapest adequate model, batched review every two chunks, cheap fixer for fix-lists. Same git-ignored markdown store as /orchestrate.
argument-hint: [task to orchestrate]
---

# Orchestration (nightly)

Invoke the `markdown-orchestration-nightly:markdown-orchestration-nightly` skill and follow it as the orchestrator and prompt-loop owner.

Task to orchestrate: $ARGUMENTS

If no task was provided above, ask the user what they want to orchestrate before doing anything else.

The skill is the source of truth for the full workflow. Follow it exactly; do not fall back to the stable `markdown-orchestration` skill mid-epic.
