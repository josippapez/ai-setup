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

let digest;
try {
  digest = fs.readFileSync(path.join(root, "rules-digest.md"), "utf8").trim();
} catch {
  process.exit(0); // no digest file — nothing to add
}
if (!digest) process.exit(0);

// Phrased as a statement of what is already in context. Text framed as an
// out-of-band system command can trip prompt-injection defenses, which surfaces it
// to the user instead of applying it.
const additionalContext =
  "[rules-reminder] The interactive-mcp plugin's always-on rules were injected in " +
  "full at the start of this session and still apply to this message. What follows " +
  "is a condensed restatement of them, not a replacement or a relaxation: where the " +
  "two differ, the full rules govern.\n\n" +
  digest;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext },
  })
);
