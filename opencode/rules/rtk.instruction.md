---
applyTo: "**"
name: rtk
description: How the rtk token-optimizing proxy rewrites bash commands, and the one hard rule that follows from it - never grep -r from bash, use the grep tool or rg, because rtk grep ignores .gitignore and can emit megabytes from a single generated file.
---

# RTK — Rust Token Killer

`plugins/rtk/index.ts` intercepts every bash/shell call and runs `rtk rewrite <command>`, so commands are
transparently token-optimized: `git status` → `rtk git status`, `cat f` → `rtk read f`,
`grep` → `rtk grep`, `rg` → `rtk rg`, `find` → `rtk find`, `ls` → `rtk ls`. Commands inside a quoted
`bash -c '...'` are rewritten too. Heredocs, `sed`, and multi-line blocks are left alone. Verified
against rtk 1.0.1. If `rtk` is not on PATH the plugin
no-ops.

Only bash goes through rtk. The dedicated read/edit/write/**grep**/glob tools do not.

## Never `grep -r` from bash

`rtk grep` does **not** respect `.gitignore` and does **not** enforce its own `--max-len`, so one long
line in a generated file becomes one enormous line of output — which is what stalls a bash call.
Measured (rtk 1.0.1): `rtk grep -rn <pat> .` emitted **58.6 MB**, almost all from a gitignored index
file, where `rtk rg -n <pat> .` emitted **147 bytes** for the same query.

- Prefer the **grep tool** (ripgrep, gitignore-aware).
- From bash, write `rg`, never `grep -r`.
- If `grep -r` is unavoidable, scope it to a path or pass `--exclude-dir=<generated-dir>`.

## Meta commands (run rtk directly, never via the rewrite)

```bash
rtk gain                # Savings summary (-H history, -g graph, -p project, -q quota)
rtk discover            # Missed savings in agent history
rtk config              # Config path + current settings
rtk hook check '<cmd>'  # Dry-run a rewrite (exits 1 when nothing is rewritten)
rtk verify              # Hook integrity + TOML filter tests
rtk trust / untrust     # Opt in/out of project-local TOML filters
```

## Escape hatches

`rtk bypass <cmd>` (old name `rtk proxy`) runs unfiltered but still tracks usage. `rtk run <cmd>` runs
the argv directly with no filtering and no tracking; `rtk run -c '<script>'` runs it through a shell. `rtk pipe` filters stdin.
