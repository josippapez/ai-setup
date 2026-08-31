---
name: self-improve
description: 'Step-by-step rollout for a decided change to agent behavior: update the owning rule or skill first, then the mirrored copies under opencode/, then the agent definitions and routing if delegation changed.'
when_to_use: 'Triggers: "make this change stick", "update your instructions", "apply this to all skills", "keep the copies in sync", "you keep doing X, stop", "harden this behavior". Use when the behavior change is already decided and needs carrying out consistently everywhere it is encoded. Use agent-guidance-authoring when the guidance wording itself still needs designing.'
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
