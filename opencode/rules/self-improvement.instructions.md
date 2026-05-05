---
applyTo: '**'
name: self-improvement
description: Workflow for repeatable agent behavior changes.
---

# Self Improvement

Use this workflow when the user asks to change repeatable agent behavior, instructions, rules, skills, agent templates, docs, or conventions.

## Required sequence

1. Classify the request as a repeatable behavior change or a one-off remediation.
2. Identify the owning documentation or canonical source first.
3. Update the owning docs before updating skills or always-on instructions when docs exist.
4. Update or create the corresponding skill workflow when task-scoped behavior changes.
5. Update or create always-on instruction/rule files when deterministic behavior must always apply.
6. Update agent templates or orchestration mapping if routing behavior changes.
7. Validate changed files and report the exact before/after behavioral delta.

## Authoring rules

- Keep one canonical source of truth; link from skills and instructions rather than duplicating long policy text.
- Use deterministic wording in always-on rules: `MUST`, `SHOULD`, and `MAY`.
- Remove stale back-references when a rule is retired or renamed.
- Prefer concise, trigger-rich skill descriptions so skills are discoverable.
