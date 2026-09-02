---
id: NN-<slug>
epic: <epic-slug>
status: Todo
labels: [agent-task]
complexity: low # low | medium | high | max — with risk, sets the build model, see references/platform.md
risk: [] # any of: security, auth, migration, concurrency, money, public-api — forces opus build + solo review
wave: 1
depends_on: []
sessions: [] # append-only CLAUDE_CODE_SESSION_ID values
---
# <Chunk title>

## Description

### Objective and scope

- Objective: <one outcome>
- Files: <exact paths>
- Constraints: <constraints>
- Acceptance criteria: <checklist>
- Validation: <commands/actual-state checks>
- Handoff: <required JSON/summary>

### Context-pack slice

- Files/reuse/blast radius: <grounded entries>
- `applicable_documented_standards`: [] # path + changed-file scope + exact clauses, or explicit empty reason
- `owning_docs`: [] # path + applicability reason, or explicit empty reason
- `non_test_quality_commands`: [] # exact commands; never tests, or explicit empty reason
- `test_surface`: [] # command + targeted/full scope, or explicit empty reason
- `solution_reuse_signals`: [] # trigger + evidence, or explicit empty reason
- Accepted solution-reuse findings: <fold in before worker, or not applicable>
- Design/ADR slice: <applicable content or not applicable>

### Routing record

- `<specialist>`: `<dispatched | skipped: reason>`

---
## Comments
<!-- Append-only. Reviewers/checkers never move frontmatter status. -->

### <YYYY-MM-DD> · md-builder — findings
- shipped: <files/behavior>
- validation: <result>
- quality commands (supplied, run verbatim): <command → pass|fail + excerpt, or "none supplied">
- test suite (supplied, run verbatim): <command → pass|fail + excerpt, or "none supplied">
- AC self-check: <result>

```diff
<relevant diff>
```

### <YYYY-MM-DD> · batch-reviewer — PASS|FAIL (batch <id>)
- AC/correctness/scope/root-cause: <details>
- documented standards (supplied clauses): <none or sourced violations>
- implementation quality (reuse/simplification/maintenance): <details>
- commands re-run: <none needed | command → result>
- fix-list (if FAIL): <items, each naming file + exact change>

### <YYYY-MM-DD> · md-fixer — follow-up
- applied: <fix-list items → what changed>
- validation: <result>
