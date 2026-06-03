---
name: agent-guidance-authoring
description: Author and evolve agent guidance — docs, patterns, skills, and instructions. Use when the user asks to change how the agent behaves in a repeatable way, add or update a skill, add or update an instruction, update docs/patterns/standards, harden a workflow, close a loophole, or make something "always happen". Triggers include phrases like "update this skill", "add a new skill", "change how you behave", "make the agent always do X", "add a rule", "this instruction is wrong", "update the docs/pattern/standard", "add an instruction", "fix this workflow", "improve this guidance".
---

# agent-guidance-authoring

Create or evolve skills, instructions, docs, and patterns that drive repeatable agent behavior. Keep skills minimal and doc-first so guidance changes in one place.

Use this skill whenever the user wants to change repeatable agent behavior or the guidance that drives it. This covers the full authoring surface: `docs/guides`, `docs/standards`, `.github/skills/**`, and `.github/instructions/**`.

## Triggers

- New repeatable workflow, pattern, or policy request.
- Existing skill/instruction behavior is ambiguous, stale, bypassable, or missing.
- User asks to harden, simplify, or close a loophole in prompting/delegation/validation behavior.
- User asks to add, rename, or delete a skill or instruction.
- User asks to update a doc/guide/standard that owns a rule.
- User asks to make something "always happen" or "never happen" again.

## Required flow (docs-first)

1. **Identify or create the owning doc** in `docs/guides` or `docs/standards`. Update it first so there is a single canonical rule source.
2. **Update or create the skill** at `.github/skills/<skill-name>/SKILL.md`. Keep it concise and link to the doc instead of duplicating guidance.
3. **Update or create the instruction** under `.github/instructions/**` when behavior must be always-on and trigger-based.
4. **Update delegation mapping** if the change affects agent routing: `.github/agents/**`, `agent-orchestration.instructions.md`, and the `agent-orchestration` skill.
5. **Validate consistency** across docs + skill + instruction, and call out the exact behavior delta (before → after) in handoff.

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
- If a skill touches mobile code, reference `docs/standards/patterns/mobile` and keep mobile-specific detail there.
- If a requested behavior is not covered by an existing skill, create a new skill (or instruction) that points to the owning doc before proceeding.

## References

- [docs/guides/agent-files.md](../../../docs/guides/agent-files.md)
- docs/standards/patterns
- docs/guides (update the specific guide before adjusting skills)
- `.github/agents/self-improve-specialist.agent.md` — delegate non-trivial cross-surface changes
