#!/usr/bin/env bash
# Shared helpers for the installers. Sourced, never executed directly.
#
# Policy: use the popular, expected tool for each job — Homebrew for packages (it
# runs on Linux too, so one channel covers both platforms) and nvm for Node.
# Every install path degrades to a warning rather than aborting, except Node,
# which is a hard requirement.
#
# Kept bash-3.2 compatible: macOS still ships bash 3.2, so no associative
# arrays, no ${var,,}, no mapfile.

NVM_VERSION="${NVM_VERSION:-v0.40.6}"

have() { command -v "$1" >/dev/null 2>&1; }

warn() { printf 'Warning: %s\n' "$1" >&2; }

ai_setup_os() {
  case "$(uname -s)" in
    Darwin) echo macos ;;
    Linux) echo linux ;;
    *) echo unsupported ;;
  esac
}

ai_setup_arch() {
  case "$(uname -m)" in
    arm64 | aarch64) echo arm64 ;;
    x86_64 | amd64) echo x86_64 ;;
    *) echo unsupported ;;
  esac
}

# Download to a path with whichever fetcher exists. Returns non-zero only if
# nothing can fetch, so callers can degrade instead of dying.
fetch_to() {
  url="$1"
  out="$2"
  if have curl; then
    curl -fsSL "$url" -o "$out"
    return $?
  fi
  if have wget; then
    wget -qO "$out" "$url"
    return $?
  fi
  # Minimal images (e.g. node:22-slim) ship neither curl nor wget, but node is a
  # hard requirement here anyway — so use it, following redirects because release
  # asset URLs bounce to objects.githubusercontent.com.
  if have node; then
    node -e '
      const https = require("https"), fs = require("fs");
      const [url, out] = process.argv.slice(1);
      const get = (u, hops) => {
        if (hops > 5) process.exit(1);
        https.get(u, { headers: { "user-agent": "ai-setup-installer" } }, (res) => {
          if (res.statusCode > 299 && res.statusCode < 400 && res.headers.location)
            return get(res.headers.location, hops + 1);
          if (res.statusCode !== 200) process.exit(1);
          const file = fs.createWriteStream(out);
          res.pipe(file);
          file.on("finish", () => file.close(() => process.exit(0)));
          file.on("error", () => process.exit(1));
        }).on("error", () => process.exit(1));
      };
      get(url, 0);
    ' "$url" "$out"
    return $?
  fi
  return 1
}

# ---------------------------------------------------------------- Node via nvm

# Node is required: every hook, both MCP servers and the OpenCode plugins are
# Node scripts. nvm is the usual way people get it, and it needs no sudo.
ensure_node() {
  if have node; then
    printf 'node already installed: %s\n' "$(node -v 2>/dev/null || echo present)"
    return 0
  fi
  if [ "${AI_SETUP_SKIP_NODE_INSTALL:-0}" = "1" ]; then
    printf 'Error: Node.js is required but AI_SETUP_SKIP_NODE_INSTALL=1 was set.\n' >&2
    return 1
  fi

  printf 'Node.js not found — installing it with nvm (%s)...\n' "$NVM_VERSION"
  if install_node_with_nvm && have node; then
    printf 'node installed: %s\n' "$(node -v)"
    return 0
  fi

  printf 'Error: Node.js is required and the nvm install did not succeed.\n' >&2
  printf '  Install it manually, then re-run: https://github.com/nvm-sh/nvm#installing-and-updating\n' >&2
  return 1
}

install_node_with_nvm() {
  NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  export NVM_DIR

  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    # No node yet, so fetch_to's node fallback cannot help here — nvm's own
    # installer needs curl or wget regardless.
    if ! have curl && ! have wget; then
      warn "installing nvm needs curl or wget; install one (or Node itself) first."
      return 1
    fi
    tmp_installer="$(mktemp)"
    if ! fetch_to "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" "$tmp_installer"; then
      rm -f "$tmp_installer"
      warn "could not download the nvm installer."
      return 1
    fi
    # Skip nvm's own shell-profile "use" step; we source it explicitly below.
    PROFILE=/dev/null bash "$tmp_installer" >/dev/null 2>&1 || {
      rm -f "$tmp_installer"
      warn "the nvm installer failed."
      return 1
    }
    rm -f "$tmp_installer"
  fi

  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh" || return 1
  nvm install --lts >/dev/null 2>&1 || return 1

  # Deliberately NOT calling `nvm use`: in a non-interactive shell it terminates
  # the process outright rather than returning (verified on Debian 12 — even
  # `nvm use --lts || true` exits 127 and kills the installer). `nvm install`
  # already activates the version it installed.
  if ! have node; then
    node_bin="$(find "$NVM_DIR/versions/node" -maxdepth 2 -type d -name bin 2>/dev/null | sort | tail -n 1)" || true
    if [ -n "$node_bin" ]; then
      PATH="$node_bin:$PATH"
      export PATH
    fi
  fi
  have node
}

# ------------------------------------------------------------ packages via brew

# Homebrew runs on Linux as well as macOS, so it is the default package channel
# on both. Installing it needs sudo plus build tooling on Linux and it refuses to
# run as root, hence every caller keeps a fallback. AI_SETUP_SKIP_BREW=1 opts out.
install_homebrew() {
  if have brew; then return 0; fi
  if [ "${AI_SETUP_SKIP_BREW:-0}" = "1" ]; then return 1; fi
  if ! have curl; then
    warn "Homebrew's installer needs curl; skipping Homebrew."
    return 1
  fi

  printf 'Installing Homebrew...\n'
  if ! NONINTERACTIVE=1 bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; then
    warn "the Homebrew installer failed."
    return 1
  fi

  # Put brew on PATH for the rest of THIS run; its installer only edits the
  # user's shell profile, which does not affect an already-running shell.
  for prefix in /home/linuxbrew/.linuxbrew /opt/homebrew /usr/local "$HOME/.linuxbrew"; do
    if [ -x "$prefix/bin/brew" ]; then
      eval "$("$prefix/bin/brew" shellenv)"
      break
    fi
  done
  have brew
}

# ----------------------------------------------------------------------- rtk

# rtk (Rust Token Killer) backs the PreToolUse hook in claude/settings.json.
# Never fatal: a missing rtk only means the hook no-ops.
install_codegraph() {
  if have codegraph; then
    printf 'codegraph already installed: %s\n' "$(codegraph version 2>/dev/null || echo present)"
    codegraph telemetry off >/dev/null 2>&1 || true
    return 0
  fi
  if [ "${AI_SETUP_SKIP_CODEGRAPH:-0}" = "1" ]; then
    warn "skipping codegraph install (AI_SETUP_SKIP_CODEGRAPH=1); the codegraph MCP server and prompt hook will fail until codegraph is on PATH."
    return 0
  fi
  if have npm && npm i -g --no-audit --no-fund @colbymchenry/codegraph; then
    codegraph telemetry off >/dev/null 2>&1 || true
    return 0
  fi
  warn "could not install codegraph via npm; install it manually: curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh"
}

install_rtk() {
  if have rtk; then
    printf 'rtk already installed: %s\n' "$(rtk --version 2>/dev/null || echo present)"
    return 0
  fi
  if [ "${AI_SETUP_SKIP_RTK:-0}" = "1" ]; then
    warn "skipping rtk install (AI_SETUP_SKIP_RTK=1); the PreToolUse hook will no-op until rtk is on PATH."
    return 0
  fi

  install_homebrew || true

  if have brew; then
    # The bare name collides with homebrew/core/rtk, so tap-qualify it. The tap's
    # formula carries both macOS and Linux URLs.
    if brew install rtk-ai/tap/rtk; then return 0; fi
    warn "brew install rtk-ai/tap/rtk failed; trying the release archive."
  fi

  install_rtk_release
}

install_rtk_release() {
  asset=""
  case "$(ai_setup_os)/$(ai_setup_arch)" in
    macos/arm64) asset="rtk-aarch64-apple-darwin.tar.gz" ;;
    macos/x86_64) asset="rtk-x86_64-apple-darwin.tar.gz" ;;
    linux/arm64) asset="rtk-aarch64-unknown-linux-gnu.tar.gz" ;;
    linux/x86_64) asset="rtk-x86_64-unknown-linux-musl.tar.gz" ;;
    *)
      warn "no prebuilt rtk for $(uname -s)/$(uname -m); install it manually (https://www.rtk-ai.app)."
      return 0
      ;;
  esac

  if ! have tar; then
    warn "tar is required to install rtk; skipping."
    return 0
  fi

  bin_dir="${AI_SETUP_BIN_DIR:-$HOME/.local/bin}"
  tmp_dir="$(mktemp -d)"
  url="https://github.com/rtk-ai/rtk/releases/latest/download/$asset"

  if ! fetch_to "$url" "$tmp_dir/rtk.tar.gz"; then
    rm -rf "$tmp_dir"
    warn "could not download rtk from $url; install it manually."
    return 0
  fi
  if ! tar -xzf "$tmp_dir/rtk.tar.gz" -C "$tmp_dir"; then
    rm -rf "$tmp_dir"
    warn "could not unpack the rtk archive; install it manually."
    return 0
  fi

  # Release layout isn't guaranteed flat, so locate the binary rather than
  # assuming a path.
  rtk_bin="$(find "$tmp_dir" -type f -name rtk | head -n 1)" || true
  if [ -z "$rtk_bin" ]; then
    rm -rf "$tmp_dir"
    warn "no rtk binary inside $asset; install it manually."
    return 0
  fi

  mkdir -p "$bin_dir"
  cp "$rtk_bin" "$bin_dir/rtk"
  chmod +x "$bin_dir/rtk"
  rm -rf "$tmp_dir"

  # Prebuilt binaries carry a glibc floor (the arm64 Linux build needs 2.39+), so
  # prove it runs before leaving it on PATH. A broken rtk is worse than none: the
  # PreToolUse hook shells out to it on every Bash call.
  if ! "$bin_dir/rtk" --version >/dev/null 2>&1; then
    # `|| true`: this command is EXPECTED to fail, and under `set -e` an
    # assignment inherits its substitution's status — which killed the
    # installer mid-error-message before this guard existed.
    detail="$("$bin_dir/rtk" --version 2>&1 | head -n 1)" || true
    rm -f "$bin_dir/rtk"
    warn "the prebuilt rtk does not run here, so it was removed: ${detail}"
    warn "install it via Homebrew, or the .deb/.rpm at https://github.com/rtk-ai/rtk/releases"
    return 0
  fi

  printf 'Installed rtk to %s\n' "$bin_dir/rtk"
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) warn "$bin_dir is not on PATH; add it so the settings.json hooks can find rtk." ;;
  esac
}
