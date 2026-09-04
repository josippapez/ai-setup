#!/usr/bin/env bash
set -euo pipefail

# Installs this source-owned OpenCode configuration into ~/.config/opencode.
# It is idempotent. Claude-equivalent orchestration assets are manually ported
# and source-owned in this directory.

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
# shellcheck source=../scripts/install-common.sh
. "$(cd "$SRC/.." && pwd)/scripts/install-common.sh"

# The config reconcile below is a node one-liner; without this a missing node
# died as a bare "node: command not found" halfway through the install.
ensure_node

# codegraph backs the `codegraph` MCP server in opencode.json. Per repo: `codegraph init`.
install_codegraph

mkdir -p "$DEST" "$DEST/agents" "$DEST/commands" "$DEST/plugins" "$DEST/rules" "$DEST/skills"

cp "$SRC/env.sh" "$DEST/env.sh"

# Keep these variables literal so they resolve when the user's profile loads.
# shellcheck disable=SC2016
env_source_line='[ -r "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/env.sh" ] && . "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/env.sh"'
case "$(basename "${SHELL:-}")" in
  zsh) shell_profile="${ZDOTDIR:-$HOME}/.zshrc" ;;
  bash) shell_profile="$HOME/.bashrc" ;;
  *) shell_profile="$HOME/.profile" ;;
esac
mkdir -p "$(dirname "$shell_profile")"
touch "$shell_profile"
if ! grep -Fqx "$env_source_line" "$shell_profile" \
  && ! grep -Eq '^[[:space:]]*export[[:space:]]+OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=(true|1)[[:space:]]*$' "$shell_profile"; then
  printf '\n# OpenCode defaults managed by ai-setup.\n%s\n' "$env_source_line" >> "$shell_profile"
fi

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
  # ${DEST:?} so an unset/empty DEST aborts instead of expanding to "/agents".
  rm -rf "${DEST:?}/$directory"
  if [ -d "$SRC/$directory" ]; then
    cp -R "$SRC/$directory" "$DEST/$directory"
  else
    mkdir -p "$DEST/$directory"
  fi
done

if command -v npm >/dev/null 2>&1; then
  npm install --omit=dev --prefix "$DEST"
else
  echo "Warning: npm is unavailable; install dependencies in $DEST manually." >&2
fi

echo "Installed OpenCode config to $DEST:"
echo "  - base config, plugins, rules, skills, and agents"
echo "  - background subagents enabled for new shell sessions"
echo "  - Markdown orchestration skills, commands, and OpenCode-compatible agents"
echo "  - Repository-docs and CodeGraph MCP servers plus the interactive question tool for subagents"
