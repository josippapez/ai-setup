# Interactive MCP Claude Plugin

Claude-compatible mirror of the OpenCode `interactive-mcp` custom plugin.

- `runtime/` contains the standalone MCP server copied from `opencode/plugins/interactive-mcp`.
- `.mcp.json` registers `interactive-mcp-standalone` plus bundled third-party MCP servers that should be available by default in every project: `context7` (`@upstash/context7-mcp`), `chrome-devtools` (`chrome-devtools-mcp`), and `wcag` (`wcag-guidelines-mcp`). These ship enabled with the plugin so they need no per-machine MCP config. Project- or secret-specific servers (e.g. Figma, a local Storybook endpoint) are intentionally kept out of the plugin and live at user scope in `~/.claude.json`.
- `skills/` mirrors the OpenCode skills.
- `rules/` holds always-on rules bundled with the plugin (llm-coding-guidelines, opensrc, user-interaction). Claude Code has no native plugin "rules" loader, so a second `SessionStart` hook (`hooks/inject-rules.cjs`) reads every `rules/*.md` and emits them as `additionalContext` on each session start (incl. resume/compact). This keeps the rules always-on while shipping them inside the plugin. Trade-off vs. `~/.claude/rules/`: hook-injected rules don't support per-file `paths:` frontmatter scoping — they load unconditionally.
- **Dependencies auto-install** — no manual `npm install`. A `SessionStart` hook (`hooks/hooks.json`) runs `npm install` into the plugin's persistent data dir (`${CLAUDE_PLUGIN_DATA}/node_modules`) on first session and again whenever `package.json` changes; the MCP server resolves them via `NODE_PATH`. The first session may take a moment while `@xenova/transformers` installs; later sessions are instant (deps persist across plugin updates).
- Build semantic docs index with `node runtime/tools/build-semantic-index.cjs <repo-root>`.
