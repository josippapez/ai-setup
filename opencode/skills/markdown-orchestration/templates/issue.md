---
id: NN-<slug>
epic: <epic-slug>
status: Todo
labels: [agent-task]
complexity: low # low | medium | high
wave: 1
depends_on: []
sessions: [] # append-only OPENCODE_SESSION_ID values
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

### <YYYY-MM-DD> · worker — findings
- shipped: <files/behavior>
- validation: <result>
- AC self-check: <result>

```diff
<relevant diff>
```

### <YYYY-MM-DD> · code-standards-checker — PASS|FAIL
- supplied standards checked: <path + clauses>
- violations: <none or sourced list>

### <YYYY-MM-DD> · quality-gates-checker — PASS|FAIL
- supplied non-test commands: <command/result>

### <YYYY-MM-DD> · md-reviewer — PASS|FAIL
- AC/correctness/scope/root-cause result: <details>

### <YYYY-MM-DD> · implementation-quality-reviewer — PASS|FAIL
- reuse/simplification/maintenance result: <details>

### <YYYY-MM-DD> · regression-checker — PASS|FAIL
- supplied suite: <result>
