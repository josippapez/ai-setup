---
name: agent-guidance-authoring
description: Author and evolve agent guidance — docs, patterns, skills, and instructions. Use when the user asks to change how the agent behaves in a repeatable way, add or update a skill, add or update an instruction, update docs/patterns/standards, harden a workflow, close a loophole, or make something "always happen". Triggers include phrases like "update this skill", "add a new skill", "change how you behave", "make the agent always do X", "add a rule", "this instruction is wrong", "update the docs/pattern/standard", "add an instruction", "fix this workflow", "improve this guidance".
---

# agent-guidance-authoring

Create or evolve skills, instructions, docs, and patterns that drive repeatable agent behavior. Keep skills minimal and doc-first so guidance changes in one place.

Use this skill whenever the user wants to change repeatable agent behavior or the guidance that drives it. This covers the full authoring surface: the always-on rules/instructions and the skills, across each platform adapter (`claude/`, `opencode/`).

## Triggers

- New repeatable workflow, pattern, or policy request.
- Existing skill/instruction behavior is ambiguous, stale, bypassable, or missing.
- User asks to harden, simplify, or close a loophole in prompting/delegation/validation behavior.
- User asks to add, rename, or delete a skill or instruction.
- User asks to update a doc/guide/standard that owns a rule.
- User asks to make something "always happen" or "never happen" again.

## Required flow (single-source-first)

1. **Identify the owning guidance** — the one file that should canonically own this behavior (an always-on rule, or a skill). Update it first so there is a single source of truth.
2. **Update or create the skill** (`claude/plugins/*/skills/<name>/SKILL.md`, mirrored under `opencode/skills/`). Keep it concise and link to the owning rule instead of duplicating guidance.
3. **Update or create the always-on rule** (`claude/rules/**`, mirrored under `opencode/rules/`) when behavior must be always-on and trigger-based.
4. **Update delegation mapping** if the change affects agent routing: the agent definitions and the `agent-orchestration` skill.
5. **Validate consistency** across rule + skill, and call out the exact behavior delta (before → after) in handoff.

For non-trivial cross-surface changes, prefer delegating to the `self-improve-specialist` agent.

## Definition of done

A change is complete only when all applicable items are true:

1. The owning doc is updated first (or newly created).
2. The skill file exists, is concise, and references the doc rather than restating it.
3. A matching instruction file exists when always-on enforcement is required.
4. Skill has a clear `name`, trigger-rich `description`, and actionable sections (triggers, required flow, references).
5. Handoff mentions which doc, skill, and instruction were added or updated.

## Description authoring rules

Skill `description` fields are the primary discovery surface — weak descriptions cause skills to never be loaded.

- Start with what the skill _does_ in one short clause.
- Follow with "Use when …" listing concrete scenarios.
- End with "Triggers include …" listing concrete user phrases the model should match on.
- Prefer user-language keywords over internal jargon (e.g. "update this rule" beats "self-improve").
- Avoid the low-signal prefix "Skill for …" on its own.

## Best practices

- Keep skills minimal and doc-first; change guidance in one place.
- Keep instructions trigger-based, deterministic, and use `MUST`/`SHOULD`/`MAY`.
- Prefer one canonical rule source; avoid near-duplicate policy text across skills and instructions.
- If a requested behavior is not covered by an existing skill, create a new skill (or instruction) that points to the owning rule before proceeding.

## References

- `self-improve` skill — companion workflow for behavior changes.
