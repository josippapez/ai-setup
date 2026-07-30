#!/usr/bin/env bash
set -euo pipefail

# One-shot bootstrap for a new machine — clone (or update) this repo, then install.
#
#   curl -fsSL https://raw.githubusercontent.com/josippapez/ai-setup/main/bootstrap.sh | bash
#   curl -fsSL .../bootstrap.sh | bash -s -- --claude     # pass flags through to install.sh
#
# Env:
#   AI_SETUP_DIR    clone location (default ~/.ai-setup)
#   AI_SETUP_REPO   source repo URL
#   AI_SETUP_REF    branch/tag/commit to install (default main)
#
# Self-contained on purpose: this is the one file fetched before the repo exists,
# so it must not source anything from it.

REPO="${AI_SETUP_REPO:-https://github.com/josippapez/ai-setup.git}"
DIR="${AI_SETUP_DIR:-$HOME/.ai-setup}"
REF="${AI_SETUP_REF:-main}"

if ! command -v git >/dev/null 2>&1; then
  printf 'Error: git is required.\n' >&2
  printf '  macOS: xcode-select --install    Debian/Ubuntu: sudo apt install git\n' >&2
  exit 1
fi

if [ -d "$DIR/.git" ]; then
  # Never clobber local work: an uncommitted change means someone is editing this
  # checkout, so install what's on disk rather than resetting over it.
  if [ -n "$(git -C "$DIR" status --porcelain)" ]; then
    printf 'Existing checkout at %s has uncommitted changes — installing it as-is (no update).\n' "$DIR"
  else
    printf 'Updating %s (%s)...\n' "$DIR" "$REF"
    git -C "$DIR" fetch --quiet origin "$REF"
    git -C "$DIR" checkout --quiet FETCH_HEAD
  fi
else
  printf 'Cloning %s into %s...\n' "$REPO" "$DIR"
  git clone --quiet "$REPO" "$DIR"
  git -C "$DIR" checkout --quiet "$REF"
fi

exec bash "$DIR/install.sh" "$@"
