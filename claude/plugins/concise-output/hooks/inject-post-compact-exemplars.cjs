#!/usr/bin/env node
// SessionStart(source=compact) hook: after a compaction the style text survives in the
// system prompt, but the session's own short answers are summarized away. Measured in
// arm N: the same four questions grew from a 389-char median before the boundary to 510
// after, while the uncompacted control tightened to 261. This puts a few specimen
// answers back so the target length has an example again, not just a rule.
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let source = "";
  try { source = (JSON.parse(raw) || {}).source || ""; } catch {}
  if (source !== "compact") process.exit(0);

  const additionalContext = [
    "[length-calibration] The conversation was just compacted, so your earlier answers in",
    "this session are gone from the transcript. The output style still applies unchanged.",
    "These are specimens of the target length and shape, from other sessions. Match them.",
    "",
    'Q: "What does the retry wrapper do?"',
    "A: Retries a failed request up to three times with a doubling delay, starting at 200ms",
    "(`src/net/retry.ts:14`). It only retries 5xx and network errors, so a 400 fails straight",
    "away.",
    "",
    'Q: "Why is the build slow?"',
    "A: Type-checking runs twice, once in the bundler plugin and once in the `typecheck`",
    "script (`vite.config.ts:31`, `package.json:9`). Dropping the plugin copy takes the cold",
    "build from 94s to 61s, measured.",
    "",
    'Q: "Is the cache safe to share between tenants?"',
    "A: No. The key is the query string alone (`src/cache/key.ts:8`), so two tenants asking",
    "the same question hit one entry. Add the tenant id to the key.",
  ].join("\n");

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
  }));
});
