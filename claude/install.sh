#!/usr/bin/env bash
set -euo pipefail

# Installs the source-owned Claude Code config from this repo into ~/.claude.
# Idempotent: safe to re-run. Mirrors claude/ -> ~/.claude/.

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.claude"
# The plugin marketplace manifest lives at the repo root (one level above this claude/ dir).
REPO_ROOT="$(cd "$SRC/.." && pwd)"

mkdir -p "$DEST/rules" "$DEST/skills" "$DEST/agents"

# Ensure rtk (Rust Token Killer) is installed — settings.json hooks depend on it.
# Install from the rtk-ai tap explicitly; the bare name collides with homebrew/core/rtk.
if command -v rtk >/dev/null 2>&1; then
  echo "rtk already installed: $(rtk --version 2>/dev/null || echo present)"
elif command -v brew >/dev/null 2>&1; then
  brew install rtk-ai/tap/rtk
else
  echo "Warning: rtk not found and Homebrew unavailable; install rtk manually (https://www.rtk-ai.app)." >&2
fi

# Copy top-level config files.
cp "$SRC/CLAUDE.md" "$DEST/CLAUDE.md"
cp "$SRC/RTK.md" "$DEST/RTK.md"

# Copy settings.json as-is. No secret reconcile is needed: MCP servers — the only
# thing that carried hardcoded keys — now live in plugins (.mcp.json) or at user
# scope in ~/.claude.json, never in this file.
cp "$SRC/settings.json" "$DEST/settings.json"

# Copy user-level rules (auto-loaded by Claude Code from ~/.claude/rules/).
cp "$SRC"/rules/*.md "$DEST/rules/"

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
claude plugin marketplace remove ai-setup >/dev/null 2>&1 || true
claude plugin marketplace add "$REPO_ROOT"

# Install or update the interactive-mcp plugin.
if claude plugin list 2>/dev/null | grep -q "interactive-mcp@ai-setup"; then
  claude plugin update interactive-mcp@ai-setup
else
  claude plugin install interactive-mcp@ai-setup --scope user
fi

# Install or update the linear-orchestration plugin.
if claude plugin list 2>/dev/null | grep -q "linear-orchestration@ai-setup"; then
  claude plugin update linear-orchestration@ai-setup
else
  claude plugin install linear-orchestration@ai-setup --scope user
fi
# Remove loose files migrated into the linear-orchestration plugin (now plugin-provided).
# Includes the grilling/domain-modeling/grill-with-docs skills relocated from skills/ into the plugin.
rm -rf "$DEST/skills/linear-orchestration" "$DEST/skills/grilling" "$DEST/skills/domain-modeling" "$DEST/skills/grill-with-docs" "$DEST/agents/linear-worker.md" "$DEST/agents/linear-reviewer.md" "$DEST/rules/linear-orchestration.instructions.md"
# Remove rules retired from source (deleting from src/ doesn't prune the deployed copy).
rm -f "$DEST/rules/interactive-prompt-loop.instructions.md"

# interactive-mcp runtime deps (@xenova/transformers) auto-install via the plugin's
# SessionStart hook into ${CLAUDE_PLUGIN_DATA}/node_modules on first session — no manual
# npm step here, and the same mechanism works for any consumer who installs the plugin.

echo "Installed Claude config to $DEST:"
echo "  - CLAUDE.md, RTK.md, settings.json"
echo "  - rules/ (*.md)"
echo "  - skills/, agents/"
echo "  - interactive-mcp@ai-setup plugin (marketplace + deps)"
echo "  - linear-orchestration@ai-setup plugin"
