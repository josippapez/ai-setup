#!/usr/bin/env bash
set -euo pipefail

# Universal installer for this repo's Claude Code and OpenCode configuration.
# Works on macOS and Linux. Idempotent — safe to re-run.
#
#   ./install.sh              # install both adapters
#   ./install.sh --claude     # Claude Code config only
#   ./install.sh --opencode   # OpenCode config only
#
# Env: AI_SETUP_SKIP_RTK=1 skips the rtk install, AI_SETUP_BIN_DIR overrides
# where the Linux rtk binary lands (default ~/.local/bin).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/install-common.sh
. "$ROOT/scripts/install-common.sh"

want_claude=0
want_opencode=0

usage() {
  cat <<'EOF'
Usage: ./install.sh [--claude] [--opencode] [--help]

  (no flags)   install both the Claude Code and OpenCode configuration
  --claude     install the Claude Code configuration only
  --opencode   install the OpenCode configuration only

Environment:
  AI_SETUP_SKIP_RTK=1   skip installing rtk
  AI_SETUP_BIN_DIR      where to place the rtk binary on Linux (default ~/.local/bin)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --claude) want_claude=1 ;;
    --opencode) want_opencode=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [ "$want_claude" -eq 0 ] && [ "$want_opencode" -eq 0 ]; then
  want_claude=1
  want_opencode=1
fi

os="$(ai_setup_os)"
if [ "$os" = "unsupported" ]; then
  printf 'Error: unsupported OS "%s" (this installer targets macOS and Linux).\n' "$(uname -s)" >&2
  exit 1
fi
printf 'Installing ai-setup on %s/%s from %s\n' "$os" "$(ai_setup_arch)" "$ROOT"

# Node is required by every hook and both MCP servers; install it via nvm if absent.
ensure_node

if [ "$want_claude" -eq 1 ]; then
  printf '\n== Claude Code ==\n'
  bash "$ROOT/claude/install.sh"
fi

if [ "$want_opencode" -eq 1 ]; then
  printf '\n== OpenCode ==\n'
  bash "$ROOT/opencode/install.sh"
fi

printf '\nDone.\n'
