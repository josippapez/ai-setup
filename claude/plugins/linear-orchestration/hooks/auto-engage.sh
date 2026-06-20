#!/usr/bin/env bash
# linear-orchestration auto-engage — stdout is injected into context on every user prompt.
cat <<'DIRECTIVE'
[linear-orchestration] If the user's latest message is a non-trivial, multi-step task (multiple files/steps, or needs decomposition), ENGAGE the linear-orchestration skill now: grill to a clear spec -> resolve the per-repo Linear project (git-root basename; find-or-create) -> create a parent issue + self-contained sub-issues under it -> dispatch linear-worker / linear-reviewer subagents (relayed model: the orchestrator performs ALL Linear writes) -> drive statuses to Done / partial / abandoned. Trivial one-offs: handle inline.
DIRECTIVE
