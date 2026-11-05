'use strict';
// Stop hook: at low or medium effort, ask once per turn the "are you sure?" the user otherwise
// has to type. In Sciensus sessions, medium-effort answers drew a recheck request about twice as
// often as high and above (2.1% vs 1.0% of turns), and fixed themselves once pushed.
const fs = require('node:fs');

const NUDGE = 'Before you finish, recheck your whole answer as if the user replied "are you sure?". ' +
  'For every claim that no tool result from this turn backs, open the source now (the linked item or its comments, ' +
  'the other repo, a real run of the path) and send the corrected answer. If every claim holds, end the turn with ' +
  'no further text: no confirmation, no recap.';

function toolCallsThisTurn(transcriptPath) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  } catch {
    return 0;
  }
  let calls = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    let rec;
    try { rec = JSON.parse(lines[i]); } catch { continue; }
    if (rec.isSidechain) continue;
    const content = rec.message && rec.message.content;
    if (rec.type === 'user' && !rec.isMeta) {
      const isToolResult = Array.isArray(content) && content.some((b) => b && b.type === 'tool_result');
      if (!isToolResult) break; // reached the prompt that started this turn
    }
    if (rec.type === 'assistant' && Array.isArray(content)) {
      calls += content.filter((b) => b && b.type === 'tool_use').length;
    }
  }
  return calls;
}

function decide(input, env) {
  const level = (input.effort && input.effort.level) || env.CLAUDE_EFFORT;
  if (level !== 'low' && level !== 'medium') return null;
  if (input.stop_hook_active) return null;
  // A turn with no tool calls is chat or a plan; there is nothing it could have checked.
  if (!input.transcript_path || toolCallsThisTurn(input.transcript_path) === 0) return null;
  return { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: NUDGE } };
}

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    let input = {};
    try { input = JSON.parse(raw); } catch {}
    const out = decide(input, process.env);
    if (out) process.stdout.write(JSON.stringify(out));
  });
}

module.exports = { decide, NUDGE };
