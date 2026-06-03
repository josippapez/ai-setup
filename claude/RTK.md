# RTK - Rust Token Killer

Use RTK to compact CLI output before it reaches Claude Code.

- Hook: `rtk hook claude` via `PreToolUse` for `Bash`.
- Verify: `rtk --version`, `rtk gain`, `rtk init --show`.
- OpenCode: global plugin `~/.config/opencode/plugins/rtk.ts` delegates to `rtk rewrite`.
