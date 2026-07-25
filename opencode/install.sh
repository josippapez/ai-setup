#!/usr/bin/env bash
set -euo pipefail

# Installs this source-owned OpenCode configuration into ~/.config/opencode.
# It is idempotent. Claude-equivalent orchestration assets are manually ported
# and source-owned in this directory.

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

mkdir -p "$DEST" "$DEST/agents" "$DEST/commands" "$DEST/plugins" "$DEST/rules" "$DEST/skills"

node -e '
  const fs = require("fs");
  const [sourcePath, destinationPath, claudePath] = process.argv.slice(1);
  const config = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  for (const file of [destinationPath, claudePath]) {
    try {
      const previous = JSON.parse(fs.readFileSync(file, "utf8"));
      const value = previous.mcp?.["Framelink Figma"]?.environment?.FIGMA_API_KEY
        || previous.mcpServers?.["Framelink Figma"]?.env?.FIGMA_API_KEY;
      if (value && !value.startsWith("{env:")) {
        config.mcp["Framelink Figma"].environment.FIGMA_API_KEY = value;
        break;
      }
    } catch {}
  }
  fs.writeFileSync(destinationPath, `${JSON.stringify(config, null, 2)}\n`);
' "$SRC/opencode.json" "$DEST/opencode.json" "$HOME/.claude.json"
cp "$SRC/package.json" "$DEST/package.json"

for directory in agents commands plugins rules skills; do
  rm -rf "$DEST/$directory"
  if [ -d "$SRC/$directory" ]; then
    cp -R "$SRC/$directory" "$DEST/$directory"
  else
    mkdir -p "$DEST/$directory"
  fi
done

# Remove stale copies from prior installs. Repository grounding remains provided
# by the local interactive-mcp plugin; only @rawwee/interactive-mcp is retired.
node -e '
  const fs = require("fs");
  const path = process.argv[1];
  const config = JSON.parse(fs.readFileSync(path, "utf8"));
  if (config.mcp) delete config.mcp.interactive;
  fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
' "$DEST/opencode.json"

if command -v npm >/dev/null 2>&1; then
  npm install --omit=dev --prefix "$DEST"
else
  echo "Warning: npm is unavailable; install dependencies in $DEST manually." >&2
fi

echo "Installed OpenCode config to $DEST:"
echo "  - base config, plugins, rules, skills, and agents"
echo "  - Markdown orchestration skills, commands, and OpenCode-compatible agents"
echo "  - Repository-docs MCP retained; external @rawwee/interactive-mcp removed"
