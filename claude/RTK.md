# RTK - Rust Token Killer

Verified against rtk 1.2.0.

## Hook-Based Usage

A `PreToolUse` hook (`rtk hook claude` in `settings.json`) rewrites Bash commands transparently:
`git status` → `rtk git status`, `cat f` → `rtk read f`, `head -20 f` → `rtk read f --head-lines 20`,
`tail -5 f` → `rtk read f --tail-lines 5`, `grep` → `rtk grep`, `rg` → `rtk rg`, `find` → `rtk find`,
`ls` → `rtk ls`, `diff` → `rtk diff`, `wc` → `rtk wc`, `gh` → `rtk gh`, `npx tsc` → `rtk tsc`.
In a chain only the commands are rewritten, never the text between them:
`git status && echo "git log" && ls` → `rtk git status && echo "git log" && rtk ls`.
Commands inside a quoted `bash -c '...'` / `sh -c '...'` are rewritten too.
Heredocs, `sed`, and multi-line blocks (loops, `python3 - <<'PY'`) are left alone.

**Write the `rtk` form yourself** (`rtk git status`, `rtk rg`, `rtk read f`). In auto mode, once the
hook rewrites one call, Claude Code refuses every later call in the same response, Bash and MCP
alike, with "gave no verdict". A command that already starts with `rtk` passes through unchanged.
The hook also rewrites `ssh`, `curl`, `cargo` and `docker`. `rtk hook check '<cmd>'` prints what it
would make of any command.

A pipe into anything but `head` or `tail` (`cut`, `sed`, `awk`, `sort`, `wc`) also leaves the whole
command unrewritten, so rtk never filters it. To shorten long match lines, write
`rg -M 200 --max-columns-preview <pat>` instead of `rg <pat> | cut -c1-200`; the first goes through
rtk, the second does not.

Inside a Claude Code worktree (`<repo>/.claude/worktrees/<name>`) the hook leaves `git` unrewritten,
because the worktree guard rejects `rtk git`. Write plain `git` there, never `rtk git`.

Only the Bash tool is hooked. The dedicated Read/Edit/Write/**Grep**/Glob tools never go through rtk.

## Reading condensed output

Treat condensed output as the complete result. When rtk trims a long or failing output it prints
its own recovery command, `rtk recall <hash>` or a `tail` of a saved log. Run it exactly as printed
instead of re-running the original command. Re-run as `rtk bypass <cmd>` only when the result is
unusable: empty when output was clearly expected, contradicting its exit code, or garbled.

## ⚠️ Write `rg` from Bash, never `grep -r`

`grep -r` does not respect `.gitignore`, so it also searches generated and ignored files and can
return a hundred times more output than `rg`.

- From Bash, write `rg`, never `grep -r`. The Grep tool is the same ripgrep and is equally fine.
- If you must use `grep -r`, scope it to a path or pass `--exclude-dir=repo-docs`.
- To find code by its shape rather than its text (every call to a function, a JSX prop, an import),
  write `ast-grep run -p '<code pattern>' -l <lang> <path>`, e.g.
  `ast-grep run -p 'useQuery($A, $B)' -l tsx src`. It is rewritten to `rtk ast-grep`. Write
  `ast-grep`, not `sg`, which is a different program on Linux.
- ast-grep prints each whole matched node, so a match on `useEffect(...)` brings its full body. To
  list where something is, ask for locations only:
  `ast-grep run -p '<pattern>' -l tsx <path> --json=stream | jq -r '"\(.file):\(.range.start.line+1)"'`.
  `-l` covers one language: `.ts` and `.tsx` files need one run each (`-l ts`, `-l tsx`).

## Escape Hatches

```bash
rtk bypass <cmd>        # Run without output filtering, but still track usage (`rtk proxy` is the old alias)
rtk run <cmd>           # Run argv directly: no filtering, no tracking
rtk run -c '<sh>'       # Same, through a shell (plain args are not shell-expanded)
rtk pipe                # Read stdin, apply a filter, print result (Unix pipe mode)
```
