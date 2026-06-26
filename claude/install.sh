#!/usr/bin/env bash
set -euo pipefail

# Installs the source-owned Claude Code config from this repo into ~/.claude.
# Idempotent: safe to re-run. Mirrors claude/ -> ~/.claude/.

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.claude"
# The plugin marketplace manifest lives at the repo root (one level above this claude/ dir).
REPO_ROOT="$(cd "$SRC/.." && pwd)"

mkdir -p "$DEST/rules" "$DEST/hooks" "$DEST/skills" "$DEST/agents"

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

# Copy settings.json, preserving hardcoded secrets in any `env` block: where the
# committed source uses a ${VAR} placeholder but the existing live settings had a
# concrete value, keep the live value. Source stays env-ref; local deploy keeps
# working secrets. On failure, restore the previous settings so a deploy never
# leaves a working setup worse off.
PREV_SETTINGS="$(mktemp)"
if [ -f "$DEST/settings.json" ]; then cp "$DEST/settings.json" "$PREV_SETTINGS"; fi
cp "$SRC/settings.json" "$DEST/settings.json"
if ! python3 - "$DEST/settings.json" "$PREV_SETTINGS" <<'PY'
import json, re, sys
new_path, prev_path = sys.argv[1], sys.argv[2]
new = json.load(open(new_path))
try:
    prev = json.load(open(prev_path))
except Exception:
    prev = None
PLACEHOLDER = re.compile(r'^\$\{[^}]+\}$')
def reconcile(n, p):
    if not (isinstance(n, dict) and isinstance(p, dict)):
        return
    for k, v in n.items():
        pv = p.get(k)
        if k == "env" and isinstance(v, dict) and isinstance(pv, dict):
            for ek, ev in v.items():
                pev = pv.get(ek)
                if isinstance(ev, str) and PLACEHOLDER.match(ev) and isinstance(pev, str) and pev and not PLACEHOLDER.match(pev):
                    v[ek] = pev
        elif isinstance(v, dict):
            reconcile(v, pv)
if isinstance(prev, dict):
    reconcile(new, prev)
    json.dump(new, open(new_path, "w"), indent=2, ensure_ascii=False)
    open(new_path, "a").write("\n")
    print("Reconciled `env` blocks: kept hardcoded values where source uses ${VAR}.")
else:
    print("No previous settings.json to reconcile; deployed source as-is.")
PY
then
  echo "Warning: settings env reconcile failed; restoring previous settings.json." >&2
  [ -s "$PREV_SETTINGS" ] && cp "$PREV_SETTINGS" "$DEST/settings.json" || true
fi
rm -f "$PREV_SETTINGS"

# Copy user-level rules (auto-loaded by Claude Code from ~/.claude/rules/).
cp "$SRC"/rules/*.md "$DEST/rules/"

# Copy hooks (referenced by settings.json, e.g. rtk-read-interceptor.py).
cp "$SRC"/hooks/*.py "$DEST/hooks/"

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
echo "  - hooks/ (*.py)"
echo "  - skills/, agents/"
echo "  - interactive-mcp@ai-setup plugin (marketplace + deps)"
echo "  - linear-orchestration@ai-setup plugin"
