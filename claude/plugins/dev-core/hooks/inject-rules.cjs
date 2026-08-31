#!/usr/bin/env node
// SessionStart hook: inject the plugin-bundled always-on rules as session context.
// Claude Code has no native plugin "rules" loader, so a SessionStart hook emitting
// `additionalContext` is the supported way to ship standing guidance with a plugin.
// Runs on every SessionStart event (startup/resume/clear/compact/fork) so the rules
// survive context compaction (source="compact") — the only compaction-adjacent hook
// that can re-inject context; PostCompact is side-effect only (no context injection).
//
// Emitted in shards. A single additionalContext value over 10,000 characters is
// written to a file and replaced with a path plus a short preview, which silently
// truncated the whole bundle (29.5KB) down to ~2KB of rules. Claude Code delivers
// every value when several hook entries answer the same event, so hooks.json
// registers this script once per shard index and each shard stays under the cap.
const fs = require("node:fs");
const path = require("node:path");

const CAP = 9000; // headroom under Claude Code's 10,000-character additionalContext limit

const root = process.env.CLAUDE_PLUGIN_ROOT;
if (!root) process.exit(0);

// Name the plugin from its own manifest so this file can be copied verbatim into
// another plugin without the header claiming the wrong origin.
let pluginName = path.basename(root);
try {
  pluginName =
    JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8")).name ||
    pluginName;
} catch {
  // No manifest, or an unreadable one — the directory name is close enough.
}

const shard = Number(process.argv[2] || 0);
if (!Number.isInteger(shard) || shard < 0) process.exit(0);

const rulesDir = path.join(root, "rules");
let files;
try {
  files = fs.readdirSync(rulesDir).filter((f) => f.endsWith(".md")).sort();
} catch {
  process.exit(0); // no rules dir — nothing to inject
}
if (files.length === 0) process.exit(0);

const sections = files.map((f) => {
  const body = fs.readFileSync(path.join(rulesDir, f), "utf8").trim();
  return `<!-- ${f} -->\n${body}`;
});

// Greedy packing. A rule larger than CAP on its own still gets its own shard: it
// would be truncated either way, and splitting mid-rule is worse than one long one.
const shards = [];
let current = [];
let size = 0;
for (const section of sections) {
  if (current.length > 0 && size + section.length > CAP) {
    shards.push(current);
    current = [];
    size = 0;
  }
  current.push(section);
  size += section.length;
}
if (current.length > 0) shards.push(current);

if (shard >= shards.length) process.exit(0); // spare slot — nothing left to emit

const header =
  shard === 0
    ? `Always-on rules bundled with the ${pluginName} plugin. These apply to every ` +
      `session and have the same standing as user-level rules. Delivered in ${shards.length} ` +
      "parts because of the per-message context limit; this is part 1:\n\n"
    : `Always-on rules bundled with the ${pluginName} plugin, part ${shard + 1} of ${shards.length}:\n\n`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: header + shards[shard].join("\n\n---\n\n"),
    },
  })
);
