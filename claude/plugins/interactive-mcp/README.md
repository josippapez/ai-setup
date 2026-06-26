# Interactive MCP Claude Plugin

Claude-compatible mirror of the OpenCode `interactive-mcp` custom plugin.

- `runtime/` contains the standalone MCP server copied from `opencode/plugins/interactive-mcp`.
- `.mcp.json` registers `interactive-mcp-standalone` for Claude Code.
- `skills/` mirrors the OpenCode skills.
- Rules are no longer bundled in this plugin; they live at `claude/rules/` in this repo and are installed to `~/.claude/rules/`, where Claude Code auto-loads them.
- **Dependencies auto-install** — no manual `npm install`. A `SessionStart` hook (`hooks/hooks.json`) runs `npm install` into the plugin's persistent data dir (`${CLAUDE_PLUGIN_DATA}/node_modules`) on first session and again whenever `package.json` changes; the MCP server resolves them via `NODE_PATH`. The first session may take a moment while `@xenova/transformers` installs; later sessions are instant (deps persist across plugin updates).
- Build semantic docs index with `node runtime/tools/build-semantic-index.cjs <repo-root>`.
