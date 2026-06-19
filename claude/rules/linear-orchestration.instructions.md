# Linear orchestration

Trigger: a non-trivial, multi-step task (multiple files/steps, or one that needs decomposition).

Required rules:

1. For such tasks you MUST engage the `linear-orchestration` skill (grill → decompose into a Linear parent + sub-issues → dispatch workers → review → drive statuses until done/partial/abandoned). Trivial one-offs are handled inline.
2. The MAIN agent is the orchestrator and prompt-loop owner. It performs ALL Linear writes (create issues, post comments, move statuses).
3. `linear-worker` and `linear-reviewer` subagents are READ-ONLY on Linear (subagent writes are blocked by policy). Workers return `findings`; the reviewer returns `verdict` + `review_comment` + `target_status`; the orchestrator posts and moves on their behalf.
4. The reviewer decides each chunk's outcome (pass → Done; fail → In Progress + fix-list, retry cap 2; then `blocked`).
5. RTK is used for EVERY shell command by the orchestrator and all subagents.
6. Linear is the source of truth; on resume, re-read open sub-issues to rebuild state.
7. Default Linear team: `Ai agents`.

Reference: `.claude/skills/linear-orchestration/SKILL.md`
Reference: `docs/superpowers/specs/2026-06-19-linear-orchestration-design.md`
