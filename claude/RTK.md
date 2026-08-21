# RTK - Rust Token Killer

**Usage**: Token-optimized CLI proxy (60-90% savings on dev operations). Verified against rtk 0.45.0.

## Hook-Based Usage

A `PreToolUse` hook (`rtk hook claude` in `settings.json`) rewrites Bash commands transparently:
`git status` → `rtk git status`, `cat f` → `rtk read f`, `head -20 f` → `rtk read f --max-lines 20`,
`grep` → `rtk grep`, `rg` → `rtk rg`, `find` → `rtk find`, `ls` → `rtk ls`, `diff` → `rtk diff`.
Heredocs, `sed`, and multi-line blocks (loops, `python3 - <<'PY'`) are left alone.

Only the Bash tool is hooked. The dedicated Read/Edit/Write/**Grep**/Glob tools never go through rtk.

## ⚠️ Never `grep -r` from Bash — use the Grep tool or `rg`

`rtk grep` does **not** respect `.gitignore` and does **not** enforce its own `--max-len`, so a single
long line in a generated file becomes a single enormous line of output. Measured in this repo:
`rtk grep -rn <pat> .` emitted **19.8 MB** (one 19,834,723-char line from the gitignored 19 MB
`.claude/repo-docs/repo-docs-index.json`), while `rtk rg -n <pat> .` emitted **3.4 KB** for the same
query. That output volume is what stalls a Bash call.

- Prefer the **Grep tool** (ripgrep, gitignore-aware) for searching.
- From Bash, write `rg`, never `grep -r`. `rg` is rewritten to `rtk rg` and stays gitignore-aware.
- If you must use `grep -r`, scope it to a path or pass `--exclude-dir=repo-docs`.

## Meta Commands (always use rtk directly)

```bash
rtk gain                # Token savings summary (-H history, -g graph, -p this project, -q quota)
rtk discover            # Find missed savings in Claude Code history
rtk session             # RTK adoption across Claude Code sessions
rtk cc-economics        # Spending (ccusage) vs savings (rtk)
rtk config              # Show config path + current settings (--create to write defaults)
rtk hook check '<cmd>'  # Dry-run: show how the hook would rewrite a command (exits 1 if no rewrite)
rtk verify              # Verify hook integrity and run TOML filter inline tests
rtk trust / untrust     # Opt in/out of project-local TOML filters (0.44+ gates custom filters)
rtk learn               # Learn CLI corrections from Claude Code error history
```

## Escape Hatches

```bash
rtk proxy <cmd>   # Run without output filtering, but still track usage
rtk run <cmd>     # Run raw via sh -c: no filtering, no tracking
rtk pipe          # Read stdin, apply a filter, print result (Unix pipe mode)
```

Config lives at `~/Library/Application Support/rtk/config.toml` (macOS). `[filters] ignore_dirs`
does **not** affect `rtk grep`; `[hooks] exclude_commands` is the knob for opting a command out of
rewriting.

## Installation Verification

```bash
rtk --version         # Should show: rtk X.Y.Z
rtk gain              # Should work (not "command not found")
which rtk             # Verify correct binary
```

⚠️ **Name collision**: If `rtk gain` fails, you may have reachingforthejack/rtk (Rust Type Kit) installed instead.
