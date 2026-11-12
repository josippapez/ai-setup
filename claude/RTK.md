# RTK - Rust Token Killer

**Usage**: Token-optimized CLI proxy (60-90% savings on dev operations). Verified against rtk 1.2.0.

## Hook-Based Usage

A `PreToolUse` hook (`rtk hook claude` in `settings.json`) rewrites Bash commands transparently:
`git status` → `rtk git status`, `cat f` → `rtk read f`, `head -20 f` → `rtk read f --head-lines 20`,
`tail -5 f` → `rtk read f --tail-lines 5`, `grep` → `rtk grep`, `rg` → `rtk rg`, `find` → `rtk find`,
`ls` → `rtk ls`, `diff` → `rtk diff`, `wc` → `rtk wc`, `gh` → `rtk gh`, `npx tsc` → `rtk tsc`.
In a chain only the commands are rewritten, never the text between them:
`git status && echo "git log" && ls` → `rtk git status && echo "git log" && rtk ls`.
Commands inside a quoted `bash -c '...'` / `sh -c '...'` are rewritten too.
Heredocs, `sed`, and multi-line blocks (loops, `python3 - <<'PY'`) are left alone.

Inside a Claude Code worktree (`<repo>/.claude/worktrees/<name>`) the hook leaves `git` unrewritten,
because the worktree guard rejects `rtk git`. Write plain `git` there, never `rtk git`.

Only the Bash tool is hooked. The dedicated Read/Edit/Write/**Grep**/Glob tools never go through rtk.

## Reading condensed output

Treat condensed output as the complete result. When rtk trims a long or failing output it prints
its own recovery command, `rtk recall <hash>` or a `tail` of a saved log. Run it exactly as printed
instead of re-running the original command. Re-run as `rtk bypass <cmd>` only when the result is
unusable: empty when output was clearly expected, contradicting its exit code, or garbled.

## ⚠️ Write `rg` from Bash, never `grep -r`

`rtk grep` does **not** respect `.gitignore` and does **not** cap line length, so a long line in a
generated file comes through whole. Measured in this repo (rtk 1.2.0): `rtk grep -rn <pat> .`
emitted **111 KB**, almost all of it from the gitignored repo-docs index files, while
`rtk rg -n <pat> .` emitted **570 bytes** for the same query. That output volume is what stalls a
Bash call.

- From Bash, write `rg`, never `grep -r`. `rg` is rewritten to `rtk rg` and stays gitignore-aware,
  so a Bash-first session needs nothing else.
- The dedicated **Grep tool** is the same ripgrep and equally safe; it just never goes through rtk.
  Either one is fine. This section is about `grep -r`, not about which tool to reach for.
- If you must use `grep -r`, scope it to a path or pass `--exclude-dir=repo-docs`.

## Meta Commands (always use rtk directly)

```bash
rtk gain                # Token savings summary (-H history, -g graph, -p this project, -q quota)
rtk gain --recalls      # How often trimmed output was recalled, per filter
rtk discover            # Find missed savings in Claude Code history
rtk session             # RTK adoption across Claude Code sessions
rtk cc-economics        # Spending (ccusage) vs savings (rtk)
rtk config              # Show config path + current settings (--create to write defaults)
rtk config recall       # Show or set where trimmed output is kept (sqlite | tee | disabled)
rtk hook check '<cmd>'  # Dry-run: show how the hook would rewrite a command (exits 1 if no rewrite)
rtk verify              # Verify hook integrity and run TOML filter inline tests
rtk trust / untrust     # Opt in/out of project-local TOML filters
rtk learn               # Learn CLI corrections from Claude Code error history
```

## Escape Hatches

```bash
rtk bypass <cmd>        # Run without output filtering, but still track usage (`rtk proxy` is the old alias)
RTK_DISABLED=1 <cmd>    # Skip the hook rewrite for this one command
rtk run <cmd>           # Run argv directly: no filtering, no tracking
rtk run -c '<sh>'       # Same, through a shell (plain args are not shell-expanded)
rtk pipe                # Read stdin, apply a filter, print result (Unix pipe mode)
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
