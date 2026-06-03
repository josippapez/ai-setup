#!/usr/bin/env bash
set -euo pipefail

# Installs the source-owned Claude Code config from this repo into ~/.claude.
# Idempotent: safe to re-run. Mirrors claude/ -> ~/.claude/.

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.claude"

mkdir -p "$DEST/rules"

# Copy top-level config files.
cp "$SRC/CLAUDE.md" "$DEST/CLAUDE.md"
cp "$SRC/RTK.md" "$DEST/RTK.md"
cp "$SRC/settings.json" "$DEST/settings.json"

# Copy user-level rules (auto-loaded by Claude Code from ~/.claude/rules/).
cp "$SRC"/rules/*.md "$DEST/rules/"

# Register or refresh the local plugin marketplace.
if claude plugin marketplace list 2>/dev/null | grep -q "ai-setup"; then
  claude plugin marketplace update ai-setup
else
  claude plugin marketplace add "$SRC"
fi

# Install or update the interactive-mcp plugin.
if claude plugin list 2>/dev/null | grep -q "interactive-mcp@ai-setup"; then
  claude plugin update interactive-mcp@ai-setup
else
  claude plugin install interactive-mcp@ai-setup --scope user
fi

# Install plugin runtime deps (e.g. @xenova/transformers) in the installed cache copy.
# Pick the highest version dir (sort -V), not the newest mtime — plugin updates
# can copy dirs with older mtimes than a previously npm-installed version.
CACHE_BASE="$HOME/.claude/plugins/cache/ai-setup/interactive-mcp"
PLUGIN_VERSION="$(ls "$CACHE_BASE" 2>/dev/null | sort -V | tail -n1 || true)"
PLUGIN_DIR="${PLUGIN_VERSION:+$CACHE_BASE/$PLUGIN_VERSION}"
if [ -n "$PLUGIN_DIR" ]; then
  ( cd "$PLUGIN_DIR" && npm install --no-fund --no-audit )
else
  echo "Warning: installed plugin cache dir not found under $CACHE_BASE; skipped npm install." >&2
fi

echo "Installed Claude config to $DEST:"
echo "  - CLAUDE.md, RTK.md, settings.json"
echo "  - rules/ (*.md)"
echo "  - interactive-mcp@ai-setup plugin (marketplace + deps)"
