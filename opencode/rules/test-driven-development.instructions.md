---
applyTo: '**'
name: test-driven-development
description: Test-first workflow for non-trivial code changes.
---

# Test-Driven Development

Use a red-green-refactor workflow for non-trivial behavioral changes.

## Required workflow

1. Red: write a failing test that describes the expected behavior before implementation.
2. Green: write the minimum implementation that makes the test pass.
3. Refactor: clean up while keeping tests green.

## TDD is mandatory for

- Bug fixes.
- New features.
- Behavioral changes.
- Refactors that change public API or observable behavior.

## TDD can be skipped for

- Documentation-only changes.
- Pure formatting or style changes.
- Single-line typo fixes.
- Exploratory prototypes, as long as tests are added before delivery or merge.

## Test organization

- Follow the repository's existing test naming and placement conventions.
- Use descriptive test names that document expected behavior.
- Prefer tests that assert one behavior clearly.
- Extract pure logic from hooks, framework callbacks, IPC handlers, or UI wiring so it can be tested without excessive mocking.

## Handoff

- Run the relevant tests before completing code changes.
- If tests are not available or not run, state why and identify the closest validation performed.
