#!/usr/bin/env bash
set -euo pipefail

# Installs the source-owned Claude Code config from this repo into ~/.claude.
# Idempotent: safe to re-run. Mirrors claude/ -> ~/.claude/.

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
# The plugin marketplace manifest lives at the repo root (one level above this claude/ dir).
REPO_ROOT="$(cd "$SRC/.." && pwd)"
# shellcheck source=../scripts/install-common.sh
. "$REPO_ROOT/scripts/install-common.sh"

mkdir -p "$DEST/skills" "$DEST/agents" "$DEST/hooks/scripts"

# rtk (Rust Token Killer) backs the PreToolUse hook in settings.json.
install_rtk

# Copy top-level config files.
cp "$SRC/CLAUDE.md" "$DEST/CLAUDE.md"
cp "$SRC/RTK.md" "$DEST/RTK.md"

# Copy settings.json as-is. No secret reconcile is needed: MCP servers — the only
# thing that carried hardcoded keys — now live in plugins (.mcp.json) or at user
# scope in ~/.claude.json, never in this file.
cp "$SRC/settings.json" "$DEST/settings.json"

# Copy hook scripts referenced by settings.json (format-lint-edited-files).
# Their *.test.mjs siblings stay in the repo — settings.json never runs them.
for f in "$SRC"/hooks/scripts/*.mjs; do
  case "$f" in
    *.test.mjs) continue ;;
  esac
  cp "$f" "$DEST/hooks/scripts/"
done

# Rules are no longer copied loose into ~/.claude/rules/: the interactive-mcp plugin
# now bundles them and injects them via its SessionStart hook (see cleanup below).

# Copy user-level skills and agents as real copies, replacing any existing symlink or dir
# (e.g. skills installed via `npx skills` symlink into ~/.claude/skills, which `cp -R` can't overwrite).
for d in "$SRC"/skills/*/; do
  [ -d "$d" ] || continue
  rm -rf "$DEST/skills/$(basename "$d")"
  cp -R "$d" "$DEST/skills/$(basename "$d")"
done
for f in "$SRC"/agents/*; do
  [ -e "$f" ] || continue
  rm -rf "$DEST/agents/$(basename "$f")"
  cp -R "$f" "$DEST/agents/$(basename "$f")"
done

# Register or refresh the local plugin marketplace (root-level .claude-plugin/marketplace.json).
# Re-add from the repo root so a moved/renamed source path is always picked up.
# Skipped when the CLI is absent (e.g. a fresh machine where the config lands
# before Claude Code itself) — the copied files above are still valid.
if have claude; then
  claude plugin marketplace remove ai-setup >/dev/null 2>&1 || true
  claude plugin marketplace add "$REPO_ROOT"

  # Install or update the interactive-mcp plugin.
  if claude plugin list 2>/dev/null | grep -q "interactive-mcp@ai-setup"; then
    claude plugin update interactive-mcp@ai-setup
  else
    claude plugin install interactive-mcp@ai-setup --scope user
  fi

  # Remove the pre-rename plugin (linear-orchestration -> markdown-orchestration) if still installed.
  claude plugin uninstall linear-orchestration@ai-setup >/dev/null 2>&1 || true

  # Install or update the markdown-orchestration plugin.
  if claude plugin list 2>/dev/null | grep -q "markdown-orchestration@ai-setup"; then
    claude plugin update markdown-orchestration@ai-setup
  else
    claude plugin install markdown-orchestration@ai-setup --scope user
  fi
else
  warn "the 'claude' CLI is not on PATH; skipped marketplace + plugin install. Install Claude Code, then re-run this script."
fi
# Remove loose files migrated into the markdown-orchestration plugin (now plugin-provided).
# Includes the grilling/domain-modeling/grill-with-docs skills relocated from skills/ into the plugin.
rm -rf "$DEST/skills/markdown-orchestration" "$DEST/skills/grilling" "$DEST/skills/domain-modeling" "$DEST/skills/grill-with-docs" "$DEST/agents/md-worker.md" "$DEST/agents/md-reviewer.md" "$DEST/rules/markdown-orchestration.instructions.md"
# Remove rules and hook scripts retired from source (deleting from src/ doesn't prune the
# deployed copy).
rm -f "$DEST/rules/interactive-prompt-loop.instructions.md" "$DEST/hooks/scripts/prompt-loop-reminder.mjs" "$DEST/hooks/scripts/prompt-loop-reminder.test.mjs"
# Remove rules migrated into the interactive-mcp plugin (now injected via its SessionStart
# hook). Deleting the loose copies prevents them double-loading alongside the plugin's.
rm -f "$DEST/rules/llm-coding-guidelines.instruction.md" "$DEST/rules/opensrc.md" "$DEST/rules/user-interaction.instructions.md"

# interactive-mcp runtime deps (@huggingface/transformers) auto-install via the plugin's
# SessionStart hook into ${CLAUDE_PLUGIN_DATA}/node_modules on first session — no manual
# npm step here, and the same mechanism works for any consumer who installs the plugin.

echo "Installed Claude config to $DEST:"
echo "  - CLAUDE.md, RTK.md, settings.json"
echo "  - skills/, agents/"
if have claude; then
  echo "  - interactive-mcp@ai-setup plugin (marketplace + deps)"
  echo "  - markdown-orchestration@ai-setup plugin"
else
  echo "  - plugins NOT installed (no 'claude' CLI on PATH)"
fi
