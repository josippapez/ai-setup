---
applyTo: '**'
name: react-performance
description: Portable React and React Native performance guardrails.
---

# React Performance

Apply these guardrails when writing or reviewing React and React Native code.

## Async work

- Use `Promise.all()` for independent async operations.
- Move `await` into the branch where the value is actually needed.
- Check cheap synchronous conditions before awaiting remote values.

## Rendering

- Never define components inside other components; extract them to module scope.
- Derive state during render when possible instead of using effects to set derived state.
- Use functional `setState(prev => ...)` when the next value depends on previous state.
- Use lazy `useState(() => expensiveInit())` for expensive initial state.
- Add memoization only when there is an identified render cost or existing project pattern calls for it.

## Bundle size

- Avoid broad barrel imports for heavy packages when direct imports are available.
- Use dynamic imports or `React.lazy()` for heavy UI that is not needed on initial render.
- Defer non-critical analytics, logging, and third-party SDK work until after initial render when possible.

## Component architecture

- Avoid adding boolean props for unrelated behavior switches; prefer composition, explicit variants, or compound components.
- Prefer `children` composition over render-prop APIs unless a render prop materially simplifies the API.
