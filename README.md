# AI Setup

Personal backup of global OpenCode setup.

## Contents

- `opencode/agents/` - global custom agents from `~/.config/opencode/agents`.
- `opencode/skills/` - global OpenCode skills from `~/.config/opencode/skills`.
- `opencode/rules/` - global OpenCode instruction/rule files from `~/.config/opencode/rules`.
- `opencode/plugins/` - global OpenCode plugins from `~/.config/opencode/plugins`.
- `claude/` - Claude Code global config mirroring `~/.claude/`: `CLAUDE.md`, `RTK.md`, `settings.json`, `hooks/`, plus the bundled `interactive-mcp` and `linear-orchestration` plugins. Run `claude/install.sh` to install it globally.
- `opencode/opencode.json` - global OpenCode config.
- `opencode/package.json` - global plugin dependency manifest.

This repository intentionally excludes dependency folders, environment files, and secret-like filenames.
`opencode/opencode.json` mirrors the global config shape but replaces secret values with environment placeholders such as `${FIGMA_API_KEY}`.
`opencode/plugins/interactive-mcp/` is the source-owned copy of the custom OpenCode plugin; the global folder should be updated from this mirror.
Semantic docs search is built with `node ~/.config/opencode/plugins/interactive-mcp/tools/build-semantic-index.cjs <repo-root>`; generated `interactive-mcp-doc-embeddings.json` files are intentionally ignored.
`claude/` mirrors `~/.claude/` and includes a local Claude marketplace (repo-root `.claude-plugin/marketplace.json`) with two plugins: `interactive-mcp` (mirrors the OpenCode MCP tools and skills) and `linear-orchestration`.
`claude/install.sh` performs the global install, copying `CLAUDE.md`, `RTK.md`, `settings.json`, and `hooks/scripts/` into `~/.claude/`, then registering/updating the marketplace and installing both plugins.
Always-on rules are no longer copied loose into `~/.claude/rules/`: the `interactive-mcp` plugin bundles them under `claude/plugins/interactive-mcp/rules/` and injects them each session via its SessionStart hook (`inject-rules.cjs`). `install.sh` prunes any previously-installed loose copies.

## Requirements

- **Node.js** on `PATH` — the hooks in `claude/settings.json` are Node scripts (`hooks/scripts/*.mjs`) that parse the hook's stdin JSON themselves (no `jq` needed).
- **`rtk`** (Rust Token Killer) — the `PreToolUse` Bash hook runs `rtk hook claude`. `install.sh` installs it via `brew install rtk-ai/tap/rtk`, or warns if Homebrew is unavailable.
- The `PostToolUse` (`Edit`/`Write`/`MultiEdit`) hook runs `format-lint-edited-files.mjs`: Prettier (`--write`) on supported files (`.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.md`, `.css`, `.scss`, `.html`, `.yml`, `.yaml`) and, because `settings.json` sets `HOOK_RUN_ESLINT=1`, ESLint (`--fix --max-warnings=0`) on JS/TS files. Both run from each project's local `node_modules/.bin`; the hook is best-effort and silently no-ops when the tool isn't installed for that project.
