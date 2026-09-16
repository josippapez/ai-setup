---
name: self-improve
description: 'Turn a correction or a failure from this session into a skill: update the skill that should have caught it, or write a new one. Covers finding the owning file, writing the description so the skill actually triggers, and mirroring the change to the other adapters.'
when_to_use: 'Triggers: "you keep doing X", "stop doing that", "remember this for next time", "make this stick", "add a skill for this", "update that skill", "why did you not follow the rule", "that skill did not fire", "this instruction is wrong", "close that loophole". Also on your own initiative when the user corrects the same behavior twice in a session, or when a skill that should have fired did not. Use the always-on rules for what must hold on every turn; use a skill for what applies to a kind of task.'
---

# self-improve

Something went wrong in this session, or the user told you to work differently. This skill turns that into a file, so the next session starts with it.

## What goes where

| The guidance | Lives in |
|---|---|
| Holds on every turn, whatever the task | an always-on rule, `opencode/rules/*.md` |
| Applies to a kind of task, loaded on demand | a skill, `opencode/skills/<name>/SKILL.md` |
| Belongs to the repo being worked in, not to every repo | that repo's own rules or AGENTS.md |

Adding to the always-on rules costs every session and every subagent spawn, so a rule has to earn it. Default to a skill.

## Flow

1. **Name the failure.** Quote what the user said, or point at the turn where it went wrong. If you cannot name a specific case, there is nothing to write yet, and a guess makes the guidance worse.
2. **Find the file that should have caught it.** Search the existing skills and rules first. A near-miss you can sharpen beats a new file that overlaps it. Two files covering the same behavior is the failure mode this skill exists to avoid.
3. **Decide: wording or coverage.** A skill that exists but did not fire has a description problem, so fix the description (see below). A skill that fired and still allowed the failure has a content problem, so fix the body and name the loophole you closed.
4. **Write it.** One behavior per file. Say what to do, not what went wrong. Link to the owning rule rather than restating it.
5. **Mirror it.** Most skills and rules here have a Claude Code counterpart under `claude/plugins/*/skills/` and `claude/plugins/dev-core/rules/`. Copy the change across, adapting tool names (`task` here, `Agent` there), or the two adapters drift.
6. **Update routing if delegation changed.** The agent definitions in `opencode/agents/` and the `agent-orchestration` skill.
7. **Verify.** Re-read the file you wrote as if you had not been in this conversation. If it only makes sense with the session in your head, rewrite it.

## Writing a description that triggers

The `description` and `when_to_use` fields are the only thing the model sees when deciding whether to load a skill. A weak one means the skill never runs, which looks identical to the skill not existing.

- Open with what the skill does, in one clause.
- Then the concrete situations: "Use when …".
- Then the phrases a user actually types: "Triggers: …". Their words, not your internal names ("update this rule" beats "self-improve").
- Name the neighbouring skill and say which question belongs to which, so the two do not compete.
- Skip "Skill for …" as an opener. It carries no signal.

## Done when

- The owning file is updated or created, and no second file now says the same thing.
- The opencode mirror matches.
- The description names the trigger that was missed this session.
- You can state the before and after behavior in one sentence each.

## References

- `agent-orchestration` skill — routing, when the change moves work between agents
- `agents/docs-maintainer.md` / `agents/self-improve-specialist.md` — for rolling a decided change across many files
