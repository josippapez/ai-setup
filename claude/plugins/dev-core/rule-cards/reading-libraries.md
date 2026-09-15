---
name: reading-libraries
description: Read the installed source instead of assuming library internals.
---

# You are reading inside a dependency

Do not grep blind. `npx opensrc path <pkg>` returns a local cached path for the **exact installed version**, instant on repeat calls, cached under `~/.opensrc/repos/`. Then grep, find, or read that path.

Use it before assuming library internals (hooks, events, option shapes), when a library behaves unexpectedly, and to verify an option exists in the version installed here rather than a newer one. Append `2>/dev/null` when calling it inside a `$(...)` subshell.

The installed source outranks both your memory and the library's published docs, because the published docs describe whatever version is current and this repo may not be on it.
