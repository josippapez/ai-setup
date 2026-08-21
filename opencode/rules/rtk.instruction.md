---
applyTo: "**"
name: rtk
description: How the rtk token-optimizing proxy rewrites bash commands, and the one hard rule that follows from it - never grep -r from bash, use the grep tool or rg, because rtk grep ignores .gitignore and can emit megabytes from a single generated file.
---

# RTK — Rust Token Killer

`plugins/rtk.ts` intercepts every bash/shell call and runs `rtk rewrite <command>`, so commands are
transparently token-optimized: `git status` → `rtk git status`, `cat f` → `rtk read f`,
`grep` → `rtk grep`, `rg` → `rtk rg`, `find` → `rtk find`, `ls` → `rtk ls`. Heredocs, `sed`, and
multi-line blocks are left alone. Verified against rtk 0.45.0. If `rtk` is not on PATH the plugin
no-ops.

Only bash goes through rtk. The dedicated read/edit/write/**grep**/glob tools do not.

## Never `grep -r` from bash

`rtk grep` does **not** respect `.gitignore` and does **not** enforce its own `--max-len`, so one long
line in a generated file becomes one enormous line of output — which is what stalls a bash call.
Measured: `rtk grep -rn <pat> .` emitted **19.8 MB** from a single gitignored 19 MB index file, where
`rtk rg -n <pat> .` emitted **3.4 KB** for the same query.

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

`rtk proxy <cmd>` runs unfiltered but still tracks usage. `rtk run <cmd>` runs raw via `sh -c` with no
filtering and no tracking. `rtk pipe` filters stdin.
