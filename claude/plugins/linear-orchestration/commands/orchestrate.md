---
description: Orchestrate a non-trivial, multi-step task — grill to a spec, decompose into a local git-ignored markdown store (per-repo PROJECT.md, the epic as EPIC.md, chunks as issue files), and dispatch self-managing worker subagents.
argument-hint: [task to orchestrate]
---

# Orchestration

Invoke the `linear-orchestration:linear-orchestration` skill and follow it as the orchestrator and prompt-loop owner.

Task to orchestrate: $ARGUMENTS

If no task was provided above, ask the user what they want to orchestrate before doing anything else.

The skill is the source of truth for the full workflow (gate → intake/grill → explore/scout → refine/council → decompose → execute → relay/record → converge), the markdown store layout, status map, and invariants. Follow it exactly.
