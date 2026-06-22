---
name: self-improve
description: Workflow for implementing user-requested changes to agent behavior across docs, skills, and instructions.
---

# self-improve

Use this skill when a user asks to change how the agent should behave in a repeatable way.

## Triggers

- New repeatable workflow or policy request.
- Existing instruction/skill behavior is ambiguous, stale, or bypassable.
- User asks to harden or simplify prompting/delegation/validation behavior.

## Required flow

1. Update the owning guidance first — the canonical rule or skill that owns the behavior.
2. Update or add the matching skill (`claude/plugins/*/skills/**`, mirrored under `opencode/skills/`).
3. Update or add the always-on rule (`claude/rules/**`, mirrored under `opencode/rules/`) for policy constraints.
4. If delegation mapping changes, update the agent definitions and the `agent-orchestration` skill.
5. Validate consistency and call out exact behavior changes in handoff.

## Best practices

- Keep skills concise and docs-linked.
- Keep instructions trigger-based and deterministic.
- Prefer one canonical rule source; avoid near-duplicate policy text.

## References

- `agent-guidance-authoring` skill — the fuller authoring workflow.
