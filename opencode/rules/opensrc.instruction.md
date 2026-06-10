---
applyTo: "**"
name: opensrc
description: Use opensrc to read library source code before assuming internals, debugging library behaviour, or verifying an API exists in the installed version.
---

# opensrc — Library Source Lookup

Before assuming how a library works, run:

```bash
npx opensrc path <package>   # returns a local cached path, instant on repeat calls
```

Then use `grep -r`, `find`, or `cat` on the returned path. Cache lives at `~/.opensrc/repos/` keyed by exact version.

Use when:
- About to assume library internals (hooks, events, option shapes)
- A library behaves unexpectedly — read the implementation, not just docs
- Need to verify an option exists in the **installed** version, not a newer one
- `context7` only has high-level docs

Always append `2>/dev/null` when using in a subshell `$(…)`.
