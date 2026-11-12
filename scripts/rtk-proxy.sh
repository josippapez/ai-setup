#!/usr/bin/env bash
set -euo pipefail

# Turn the rtk LLM proxy on or off for Claude Code.
#
#   scripts/rtk-proxy.sh on|off|status [settings.json ...]
#
# on:     installs the rtk-proxy binary next to rtk, writes the proxy pipeline, runs the proxy as a
#         login service, and installs `claude-rtk` next to rtk: Claude Code pointed at the proxy for
#         that one session. Plain `claude` stays direct, because Claude Code turns Remote Control
#         off whenever ANTHROPIC_BASE_URL points at a host other than api.anthropic.com.
# off:    removes `claude-rtk` and the login service, and leaves the proxy running until logout
#         so sessions started with `claude-rtk` keep working. The binary and the pipeline file
#         stay; the pipeline's proxy rules do nothing while the proxy is off.
# status: shows the service and whether `claude-rtk` is installed.
#
# on and off also remove this proxy's env.ANTHROPIC_BASE_URL from the settings files, where earlier
# versions put it. Settings files default to ${CLAUDE_CONFIG_DIR:-~/.claude}/settings.json.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=install-common.sh
. "$ROOT/scripts/install-common.sh"

# rtk's default port, 8080, is also the usual dev-server port, and a backend on it then answers
# the proxy's calls or the proxy answers the browser's. OLD_URL is that earlier setting, still
# recognised as ours so `on` and `off` can move a settings file off it.
BIND="127.0.0.1:8787"
URL="http://$BIND"
OLD_URL="http://127.0.0.1:8080"
MARKER="# Managed by ai-setup scripts/rtk-proxy.sh"

action="${1:-status}"
shift || true
if [ $# -eq 0 ]; then
  set -- "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
fi

die() { printf 'Error: %s\n' "$1" >&2; exit 1; }

have rtk || die "rtk is not on PATH; run ./install.sh first."
have node || die "node is required to edit settings.json."

# rtk keeps config.toml in its config dir (~/Library/Application Support/rtk on macOS,
# ~/.config/rtk on Linux); the user pipeline lives beside it.
rtk_config_dir() {
  dirname "$(rtk config 2>/dev/null | sed -n 's/^Config: //p' | head -n 1)"
}

install_proxy_binary() {
  rtk_dir="$(dirname "$(command -v rtk)")"
  if [ -x "$rtk_dir/rtk-proxy" ]; then return 0; fi

  case "$(ai_setup_os)/$(ai_setup_arch)" in
    macos/arm64) asset="rtk-proxy-aarch64-apple-darwin.tar.gz" ;;
    macos/x86_64) asset="rtk-proxy-x86_64-apple-darwin.tar.gz" ;;
    linux/arm64) asset="rtk-proxy-aarch64-unknown-linux-musl.tar.gz" ;;
    linux/x86_64) asset="rtk-proxy-x86_64-unknown-linux-musl.tar.gz" ;;
    *) die "no prebuilt rtk-proxy for $(uname -s)/$(uname -m)." ;;
  esac
  [ -w "$rtk_dir" ] || die "$rtk_dir is not writable; rtk looks for rtk-proxy next to itself."

  # The proxy ships in the same release as rtk, so match the installed rtk version.
  version="$(rtk --version | awk '{print $2}')"
  base="https://github.com/rtk-ai/rtk/releases/download/v$version"
  tmp_dir="$(mktemp -d)"
  fetch_to "$base/$asset" "$tmp_dir/$asset" || die "could not download $base/$asset"
  fetch_to "$base/checksums.txt" "$tmp_dir/checksums.txt" || die "could not download $base/checksums.txt"

  want="$(awk -v a="$asset" '$2 == a {print $1}' "$tmp_dir/checksums.txt")"
  if have shasum; then got="$(shasum -a 256 "$tmp_dir/$asset" | awk '{print $1}')"
  else got="$(sha256sum "$tmp_dir/$asset" | awk '{print $1}')"; fi
  [ -n "$want" ] && [ "$want" = "$got" ] || die "checksum mismatch for $asset; not installing it."

  tar -xzf "$tmp_dir/$asset" -C "$tmp_dir"
  cp "$(find "$tmp_dir" -type f -name rtk-proxy | head -n 1)" "$rtk_dir/rtk-proxy"
  chmod +x "$rtk_dir/rtk-proxy"
  rm -rf "$tmp_dir"
  printf 'installed rtk-proxy %s at %s\n' "$version" "$rtk_dir/rtk-proxy"
}

# The default proxy only strips terminal noise. The ccr rule also compresses tool results over
# 1500 tokens that are already in the conversation; the originals stay in a local store for 7 days.
write_pipeline() {
  file="$(rtk_config_dir)/pipeline.toml"
  if [ -f "$file" ] && ! grep -qF "$MARKER" "$file"; then
    warn "$file exists and is not ours; left as is. Add extends = \"rtk:proxy\" and a ccr rule to it by hand."
    return 0
  fi
  mkdir -p "$(dirname "$file")"
  cat > "$file" <<EOF
$MARKER
schema_version = 1

[pipeline]
extends = "rtk:proxy"

[[proxy.request.tool_result]]
name = "ccr"
when = { tokens_gt = 1500 }
use  = ["ccr"]
EOF
}

# clear_base_url <settings.json>: removes env.ANTHROPIC_BASE_URL, but only when it points at this
# proxy, so a base URL the user set for another gateway is never touched.
clear_base_url() {
  node -e '
    const fs = require("fs");
    const [file, ...ours] = process.argv.slice(1);
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!s.env || !ours.includes(s.env.ANTHROPIC_BASE_URL)) process.exit(0);
    delete s.env.ANTHROPIC_BASE_URL;
    fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
    console.log(`${file}: removed the proxy base URL, so sessions there go direct again`);
  ' "$1" "$URL" "$OLD_URL"
}

wrapper_path() {
  printf '%s/claude-rtk\n' "$(dirname "$(command -v rtk)")"
}

is_our_wrapper() {
  [ -f "$1" ] && grep -qF "$MARKER" "$1"
}

install_wrapper() {
  wrapper="$(wrapper_path)"
  if [ -e "$wrapper" ] && ! is_our_wrapper "$wrapper"; then
    die "$wrapper exists and is not ours; move it, then run this again."
  fi
  [ -w "$(dirname "$wrapper")" ] || die "$(dirname "$wrapper") is not writable."
  cat > "$wrapper" <<EOF
#!/bin/sh
$MARKER
# Claude Code through the rtk proxy for this session only. Plain claude stays direct, which
# Remote Control needs.
export ANTHROPIC_BASE_URL=$URL
exec claude "\$@"
EOF
  chmod +x "$wrapper"
}

case "$action" in
  on)
    install_proxy_binary
    write_pipeline
    # Stop whatever holds the port first: a daemon left running by `off` would keep the login
    # service from binding. Open sessions see a second or two of refused connections and retry.
    # Credential borrowing lets a local process that sends no API key use the one Claude Code
    # relays. Nothing here needs it, so it stays off.
    rtk llm-proxy service uninstall >/dev/null 2>&1 || true
    rtk llm-proxy stop --bind "$BIND" >/dev/null 2>&1 || true
    rtk llm-proxy service install --bind "$BIND" --relay-borrowing false
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      rtk llm-proxy status --bind "$BIND" >/dev/null 2>&1 && break
      sleep 1
    done
    rtk llm-proxy status --bind "$BIND" >/dev/null 2>&1 || die "the proxy service did not come up; see: rtk llm-proxy service logs"
    install_wrapper
    for settings in "$@"; do
      if [ -f "$settings" ]; then clear_base_url "$settings"; fi
    done
    printf 'Start Claude Code with claude-rtk to go through %s. Plain claude stays direct and keeps Remote Control.\n' "$URL"
    ;;
  off)
    for settings in "$@"; do
      if [ -f "$settings" ]; then clear_base_url "$settings"; fi
    done
    wrapper="$(wrapper_path)"
    if is_our_wrapper "$wrapper"; then rm -f "$wrapper"; fi
    rtk llm-proxy service uninstall >/dev/null 2>&1 || true
    # A Claude Code session that was open while the proxy was on keeps its address until it
    # restarts, and fails with ECONNREFUSED if nothing answers there. So keep a plain daemon up
    # (no login service, gone after logout) instead of stopping the proxy under it.
    RTK_PROXY_RELAY_BORROWING=false rtk llm-proxy start --bind "$BIND" >/dev/null 2>&1 || true
    echo "rtk proxy off and claude-rtk removed. The proxy keeps running until you log out, so open"
    echo "claude-rtk sessions keep working; restart them, then 'rtk llm-proxy stop' ends it now."
    ;;
  status)
    rtk llm-proxy service status 2>&1 || true
    wrapper="$(wrapper_path)"
    if is_our_wrapper "$wrapper"; then
      printf 'claude-rtk: on (%s)\n' "$wrapper"
    else
      echo "claude-rtk: off"
    fi
    for settings in "$@"; do
      if [ -f "$settings" ] && grep -qE "\"ANTHROPIC_BASE_URL\": \"($URL|$OLD_URL)\"" "$settings"; then
        printf '%s sends every session through the proxy, which turns Remote Control off. Run scripts/rtk-proxy.sh on to move it to claude-rtk.\n' "$settings"
      fi
    done
    ;;
  *)
    die "usage: scripts/rtk-proxy.sh on|off|status [settings.json ...]"
    ;;
esac
