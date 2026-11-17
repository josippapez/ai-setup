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

A pipe into anything but `head` or `tail` (`cut`, `sed`, `awk`, `sort`, `wc`) also leaves the whole
command unrewritten. To shorten long match lines, write `rg -M 200 --max-columns-preview <pat>`
instead of `rg <pat> | cut -c1-200`; the first goes through rtk, the second does not.

Only bash goes through rtk. The dedicated read/edit/write/**grep**/glob tools do not.

## Reading condensed output

Treat condensed output as the complete result. When rtk trims a long or failing output it prints
its own recovery command, `rtk recall <hash>` or a `tail` of a saved log. Run it exactly as printed
instead of re-running the original command. Re-run as `rtk bypass <cmd>` only when the result is
unusable: empty when output was clearly expected, contradicting its exit code, or garbled.

## Never `grep -r` from bash

`grep -r` does not respect `.gitignore`, so it also searches generated and ignored files and can
return a hundred times more output than `rg`.

- Prefer the **grep tool** (ripgrep, gitignore-aware).
- From bash, write `rg`, never `grep -r`.
- If `grep -r` is unavoidable, scope it to a path or pass `--exclude-dir=<generated-dir>`.
- To find code by its shape rather than its text, write `ast-grep run -p '<code pattern>' -l <lang> <path>`,
  e.g. `ast-grep run -p 'useQuery($A, $B)' -l tsx src`. Write `ast-grep`, not `sg`.
- ast-grep prints each whole matched node. To list locations only, append
  `--json=stream | jq -r '"\(.file):\(.range.start.line+1)"'`. `-l` covers one language, so `.ts`
  and `.tsx` need one run each.

## Escape hatches

`rtk bypass <cmd>` (old name `rtk proxy`) runs unfiltered but still tracks usage. `rtk run <cmd>` runs
the argv directly with no filtering and no tracking; `rtk run -c '<script>'` runs it through a shell. `rtk pipe` filters stdin.
