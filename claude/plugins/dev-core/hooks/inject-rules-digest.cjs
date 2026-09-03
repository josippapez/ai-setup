#!/usr/bin/env node
// UserPromptSubmit hook: restate the always-on rules in condensed form next to the
// prompt.
//
// The full rules are injected once at SessionStart, which puts them at the top of
// the conversation. By turn 40 they are far from what is actually being worked on
// and their pull fades. This hook re-states the parts that decay fastest, sized so
// repeating it every message stays affordable: the full bundle is ~7,400 tokens,
// the digest is ~250.
//
// It deliberately does NOT carry the rules themselves. It points at the copy
// already in context so the digest reads as a reminder rather than a replacement
// that could be mistaken for the whole ruleset.
const fs = require("node:fs");
const path = require("node:path");

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

let digest;
try {
  digest = fs.readFileSync(path.join(root, "rules-digest.md"), "utf8").trim();
} catch {
  process.exit(0); // no digest file — nothing to add
}
if (!digest) process.exit(0);

// Where the full rules live decides how the reminder describes them. A plugin
// that ships an output style has them in the system prompt; one that ships
// rules/ has them injected as session context. Checked rather than hardcoded so
// this file stays copy-identical across plugins that use either mechanism.
const viaOutputStyle = fs.existsSync(path.join(root, "output-styles"));
const whereTheyLive = viaOutputStyle
  ? "are in your system prompt as the active output style"
  : "were injected in full at the start of this session";

// Phrased as a statement of what is already in context. Text framed as an
// out-of-band system command can trip prompt-injection defenses, which surfaces it
// to the user instead of applying it.
const additionalContext =
  `[rules-reminder] The ${pluginName} plugin's always-on rules ${whereTheyLive} ` +
  "and still apply to this message. What follows is a condensed restatement of " +
  "them, not a replacement or a relaxation: where the two differ, the full rules " +
  "govern.\n\n" +
  digest;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext },
  })
);
