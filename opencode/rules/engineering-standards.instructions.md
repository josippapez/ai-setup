---
applyTo: '**'
name: engineering-standards
description: Portable engineering standards for small, readable, safe changes.
---

# Engineering Standards

Keep changes small, direct, and easy to review.

## Function complexity

- Keep functions focused on a single responsibility.
- Prefer guard clauses and early returns over nested control flow.
- Do not use `else` when an early return handles the negative case.
- Extract complex logic only when it becomes meaningfully reusable or clearer.

## Readability

- Use descriptive names for variables, functions, components, and types.
- Avoid magic numbers and magic strings; use named constants when values carry meaning.
- Do not over-engineer simple requirements with speculative abstractions.
- Match the surrounding code style and avoid unrelated cleanup.

## React and TypeScript

- Do not perform side effects inside `useMemo`; derive values in `useMemo` and run side effects in `useEffect`.
- Delete pure pass-through wrapper functions that only forward arguments unchanged.
- Do not re-derive a value from its sources when the resolved value is already available in scope.
- Derive state during render when it can be computed from existing props/state; do not use `useEffect` plus `setState` for derived values.

## Security and logging

- Never log secrets, credentials, raw tokens, or arbitrary user-provided values.
- Sanitize errors and telemetry attributes before forwarding them to logs or analytics.
- Use explicit safe fallback messages when logging unknown errors.

## User-input regexes

- Prefer non-regex parsing (`split`, `indexOf`, explicit field constraints) for simple string operations.
- For user-supplied or API-sourced input, keep regexes anchored, finite, and easy to reason about.
- Do not use greedy wildcards (`.*`, `.+`) or nested quantifiers on user-controlled input because they increase ReDoS risk.
- Validate length before or alongside regex checks so input size is bounded.
