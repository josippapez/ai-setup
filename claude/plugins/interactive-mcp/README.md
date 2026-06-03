# Interactive MCP Claude Plugin

Claude-compatible mirror of the OpenCode `interactive-mcp` custom plugin.

- `runtime/` contains the standalone MCP server copied from `opencode/plugins/interactive-mcp`.
- `.mcp.json` registers `interactive-mcp-standalone` for Claude Code.
- `skills/` mirrors the OpenCode skills.
- Rules are no longer bundled in this plugin; they live at `claude/rules/` in this repo and are installed to `~/.claude/rules/`, where Claude Code auto-loads them.
- Run `npm install` in this plugin folder before using semantic docs search.
- Build semantic docs index with `node runtime/tools/build-semantic-index.cjs <repo-root>`.
