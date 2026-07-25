---
description: Orchestrate a non-trivial task with markdown tracking and subagents.
agent: custom-orchestrator
---

Load the `markdown-orchestration` skill and follow it as the orchestrator. The task is: $ARGUMENTS

Use OpenCode's native `question` tool for every user prompt. Route chunks through `md-worker-free`, `md-worker-terra`, `md-worker-luna`, or `md-worker-sol` by complexity, preferring the cheapest suitable tier. Retain independent review before declaring a chunk complete.
