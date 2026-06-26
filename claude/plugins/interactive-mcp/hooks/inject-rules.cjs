#!/usr/bin/env node
// SessionStart hook: inject the plugin-bundled always-on rules as session context.
// Claude Code has no native plugin "rules" loader, so a SessionStart hook emitting
// `additionalContext` is the supported way to ship standing guidance with a plugin.
// Runs on every SessionStart event (startup/resume/clear/compact) so the rules
// survive context compaction.
const fs = require("node:fs");
const path = require("node:path");

const root = process.env.CLAUDE_PLUGIN_ROOT;
if (!root) process.exit(0);

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

const additionalContext =
  "Always-on rules bundled with the interactive-mcp plugin. These apply to every " +
  "session and have the same standing as user-level rules:\n\n" +
  sections.join("\n\n---\n\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
  })
);
