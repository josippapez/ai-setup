---
description: Orchestrate a non-trivial, multi-step task through Linear — grill to a spec, decompose into a per-repo project/milestone/issues, and dispatch self-managing worker subagents.
argument-hint: [task to orchestrate]
---

# Linear orchestration

Invoke the `linear-orchestration:linear-orchestration` skill and follow it as the orchestrator and prompt-loop owner.

Task to orchestrate: $ARGUMENTS

If no task was provided above, ask the user what they want to orchestrate before doing anything else.

The skill is the source of truth for the full workflow (gate → intake/grill → decompose → execute → relay/record → converge), status map, and invariants. Follow it exactly.
