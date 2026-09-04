# AI Setup

Personal backup of global OpenCode setup.

## Install

On a new machine (macOS or Linux) — no clone needed:

```bash
curl -fsSL https://raw.githubusercontent.com/josippapez/ai-setup/main/bootstrap.sh | bash
```

That clones this repo to `~/.ai-setup` and runs the installer. Re-running it updates
the clone and reinstalls; if that checkout has uncommitted changes it installs them
as-is rather than overwriting your work.

From an existing clone, or to pick one adapter:

```bash
./install.sh              # both adapters
./install.sh --claude     # Claude Code config only
./install.sh --opencode   # OpenCode config only

curl -fsSL .../bootstrap.sh | bash -s -- --claude   # same flags through curl
```

Both are idempotent. Missing prerequisites are installed with the tool people
normally use for them: **Node via nvm**, **packages via Homebrew** (which runs on
Linux too, so one channel covers both platforms). Anything that can't be installed
degrades to a warning instead of aborting — except Node, which everything needs.

| Variable | Effect |
| --- | --- |
| `AI_SETUP_DIR` | where `bootstrap.sh` clones (default `~/.ai-setup`) |
| `AI_SETUP_REF` | branch/tag/commit to install (default `main`) |
| `AI_SETUP_SKIP_BREW=1` | never install Homebrew; use the release archive for `rtk` |
| `AI_SETUP_SKIP_RTK=1` | skip `rtk` entirely (the PreToolUse hook then no-ops) |
| `AI_SETUP_SKIP_NODE_INSTALL=1` | fail instead of installing Node via nvm |
| `AI_SETUP_BIN_DIR` | where a downloaded `rtk` binary lands (default `~/.local/bin`) |
| `CLAUDE_CONFIG_DIR` | override the Claude config dir (default `~/.claude`) |

Notes:

- The Claude plugins install only when the `claude` CLI is on `PATH`; without it the
  config files still land and the script says so. Install Claude Code, then re-run.
- `rtk` prebuilds have a glibc floor (the arm64 Linux build needs 2.39+). The
  installer runs the downloaded binary once and removes it if it can't start, since a
  broken `rtk` on `PATH` would fail the PreToolUse hook on every Bash call. Use
  Homebrew or the `.deb`/`.rpm` on older distros.
- Windows isn't supported natively (the installers are bash and assume POSIX paths).
  WSL2 works and behaves exactly like the Linux path; `rtk` itself does publish a
  Windows build if you want it outside this setup.

## Contents

- `opencode/agents/` - global custom agents from `~/.config/opencode/agents`.
- `opencode/skills/` - global OpenCode skills from `~/.config/opencode/skills`.
- `opencode/rules/` - global OpenCode instruction/rule files from `~/.config/opencode/rules`.
- `opencode/plugins/` - global OpenCode plugins from `~/.config/opencode/plugins`.
- `install.sh` / `bootstrap.sh` / `scripts/install-common.sh` - the universal (macOS + Linux) installer, its curl-able bootstrap, and their shared platform helpers.
- `claude/` - Claude Code global config mirroring `~/.claude/`: `CLAUDE.md`, `RTK.md`, `settings.json`, `hooks/`, plus the bundled `repo-docs`, `dev-core`, `concise-output`, `rules-index`, and `orchestrate` plugins. `claude/install.sh` installs just this adapter; `./install.sh` covers both.
- `opencode/opencode.json` - global OpenCode config.
- `opencode/env.sh` - OpenCode startup environment defaults, including background subagents.
- `opencode/package.json` - global plugin dependency manifest.

This repository intentionally excludes dependency folders, environment files, and secret-like filenames.
`opencode/opencode.json` mirrors the global config shape but replaces secret values with environment placeholders such as `${FIGMA_API_KEY}`.
`opencode/plugins/dev-core/` is the source-owned copy of the custom OpenCode plugin; the global folder should be updated from this mirror.
Semantic docs search uses a chunked/Orama vector engine (see `opencode/plugins/dev-core/lib/semantic-index.cjs`), indexing docs to `.opencode/repo-docs/` on session start. Indexing is automatic and incremental (only re-indexes changed files).
`claude/` mirrors `~/.claude/` and includes a local Claude marketplace (repo-root `.claude-plugin/marketplace.json`) with `repo-docs`, `dev-core`, `concise-output`, `rules-index`, and `orchestrate`; orchestration auto-loads only its compact dispatcher, which explicitly reads bundled routing/store/phase/platform references and templates on demand by absolute skill-root path. `repo-docs` bundles the shared MCP servers (`find_docs`/`read_doc`/`find_libs` for Markdown and installed packages, plus [CodeGraph](https://github.com/colbymchenry/codegraph) for the code graph) that `dev-core` and `orchestrate` both depend on rather than each shipping their own copy.
`claude/install.sh` performs the Claude-side install, copying `CLAUDE.md`, `RTK.md`, `settings.json`, and `hooks/scripts/` (test files excluded) into `~/.claude/`, then registering/updating the marketplace and installing both plugins when the `claude` CLI is available.
Always-on rules are no longer copied loose into `~/.claude/rules/`: `dev-core` bundles the engineering rules under `claude/plugins/dev-core/rules/` and injects them every session via its SessionStart hook (`inject-rules.cjs`). `install.sh` prunes any previously-installed loose copies. `concise-output` instead ships its writing rules as a Claude Code output style (`output-styles/concise-output.md`, `force-for-plugin: true`), so they load into the system prompt rather than the conversation and survive compaction unchanged. Both plugins restate a short digest on every prompt via `inject-rules-digest.cjs`.

`rules-index` is one SessionStart hook that lists the repo's `.claude/rules/` and the user's `~/.claude/rules/` files (path, `name`/`description`, `paths` globs) as a `[rules-index]` block, so path-scoped rules are known before a matching file is read.

## Requirements

Both are installed for you by `install.sh` (see [Install](#install)) — this section is what it sets up.

- **Node.js** on `PATH` — the hooks in `claude/settings.json` are Node scripts (`hooks/scripts/*.mjs`) that parse the hook's stdin JSON themselves (no `jq` needed). Installed via nvm when missing.
- **`rtk`** (Rust Token Killer) — the `PreToolUse` Bash hook runs `rtk hook claude`. Installed via `brew install rtk-ai/tap/rtk` (macOS and Linux), falling back to the upstream release archive into `~/.local/bin` when Homebrew isn't usable.
- The `PostToolUse` (`Edit`/`Write`/`MultiEdit`) hook runs `format-lint-edited-files.mjs`: Prettier (`--write`) on supported files (`.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.md`, `.css`, `.scss`, `.html`, `.yml`, `.yaml`) and, because `settings.json` sets `HOOK_RUN_ESLINT=1`, ESLint (`--fix --max-warnings=0`) on JS/TS files. Both run from each project's local `node_modules/.bin`; the hook is best-effort and silently no-ops when the tool isn't installed for that project.
