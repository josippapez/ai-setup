# AI Setup

Personal backup of global OpenCode setup.

## Contents

- `opencode/agent/` - global custom agents from `~/.config/opencode/agent`.
- `opencode/skills/` - global OpenCode skills from `~/.config/opencode/skills`.
- `opencode/rules/` - global OpenCode instruction/rule files from `~/.config/opencode/rules`.
- `opencode/plugins/` - global OpenCode plugins from `~/.config/opencode/plugins`.
- `claude/` - Claude Code global config mirroring `~/.claude/`: `CLAUDE.md`, `RTK.md`, `settings.json`, `rules/`, plus a local plugin marketplace. Run `claude/install.sh` to install it globally.
- `opencode/agents-skills/` - separately installed skills from `~/.agents/skills`.
- `opencode/opencode.json` - global OpenCode config.
- `opencode/package.json` - global plugin dependency manifest.

This repository intentionally excludes dependency folders, environment files, and secret-like filenames.
`opencode/opencode.json` mirrors the global config shape but replaces secret values with environment placeholders such as `${FIGMA_API_KEY}`.
`opencode/plugins/interactive-mcp/` is the source-owned copy of the custom OpenCode plugin; the global folder should be updated from this mirror.
Semantic docs search is built with `node ~/.config/opencode/plugins/interactive-mcp/tools/build-semantic-index.cjs <repo-root>`; generated `interactive-mcp-doc-embeddings.json` files are intentionally ignored.
`claude/` mirrors `~/.claude/` 1:1 and includes a local Claude marketplace (`claude/.claude-plugin/marketplace.json`) with an `interactive-mcp` plugin that mirrors the OpenCode MCP tools and skills.
`claude/install.sh` performs the global install, copying `CLAUDE.md`, `RTK.md`, `settings.json`, and `rules/` into `~/.claude/` and registering/updating the plugin marketplace.
Rule files live at `claude/rules/`; once installed to `~/.claude/rules/`, Claude Code auto-loads them (no `CLAUDE.md` `@import` needed).
