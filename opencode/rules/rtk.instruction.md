---
applyTo: "**"
name: rtk
description: How the rtk token-optimizing proxy rewrites bash commands, and the one hard rule that follows from it - never grep -r from bash, use the grep tool or rg, because rtk grep ignores .gitignore and passes generated files through whole.
---

# RTK — Rust Token Killer

`plugins/rtk/index.ts` intercepts every bash/shell call and runs `rtk rewrite <command>`, so commands are
transparently token-optimized: `git status` → `rtk git status`, `cat f` → `rtk read f`,
`grep` → `rtk grep`, `rg` → `rtk rg`, `find` → `rtk find`, `ls` → `rtk ls`. In a chain only the
commands are rewritten, never the text between them. Commands inside a quoted `bash -c '...'` are
rewritten too. Heredocs, `sed`, and multi-line blocks are left alone. Verified against rtk 1.2.0.
If `rtk` is not on PATH the plugin no-ops.

Only bash goes through rtk. The dedicated read/edit/write/**grep**/glob tools do not.

## Reading condensed output

Treat condensed output as the complete result. When rtk trims a long or failing output it prints
its own recovery command, `rtk recall <hash>` or a `tail` of a saved log. Run it exactly as printed
instead of re-running the original command. Re-run as `rtk bypass <cmd>` only when the result is
unusable: empty when output was clearly expected, contradicting its exit code, or garbled.

## Never `grep -r` from bash

`rtk grep` does **not** respect `.gitignore` and does **not** cap line length, so a long line in a
generated file comes through whole — which is what stalls a bash call. Measured (rtk 1.2.0):
`rtk grep -rn <pat> .` emitted **111 KB**, almost all from gitignored index files, where
`rtk rg -n <pat> .` emitted **570 bytes** for the same query.

- Prefer the **grep tool** (ripgrep, gitignore-aware).
- From bash, write `rg`, never `grep -r`.
- If `grep -r` is unavoidable, scope it to a path or pass `--exclude-dir=<generated-dir>`.

## Meta commands (run rtk directly, never via the rewrite)

```bash
rtk gain                # Savings summary (-H history, -g graph, -p project, -q quota)
rtk discover            # Missed savings in agent history
rtk config              # Config path + current settings
rtk config recall       # Where trimmed output is kept (sqlite | tee | disabled)
rtk hook check '<cmd>'  # Dry-run a rewrite (exits 1 when nothing is rewritten)
rtk verify              # Hook integrity + TOML filter tests
rtk trust / untrust     # Opt in/out of project-local TOML filters
```

## Escape hatches

`rtk bypass <cmd>` (old name `rtk proxy`) runs unfiltered but still tracks usage. `RTK_DISABLED=1 <cmd>`
skips the rewrite for one command. `rtk run <cmd>` runs
the argv directly with no filtering and no tracking; `rtk run -c '<script>'` runs it through a shell. `rtk pipe` filters stdin.
