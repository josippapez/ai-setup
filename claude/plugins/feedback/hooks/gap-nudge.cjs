#!/usr/bin/env node
'use strict';

// UserPromptSubmit hook. Scores the agent's previous answer with a local classifier and, when it
// looks like the answer named a gap (wrong or stale doc, skill, rule, script or config), adds a
// suggestion to log it. False alarms are cheap by design: the agent just ignores the note.

const fs = require('node:fs');
const path = require('node:path');

const MODEL = require('./gap-model.json');
const COLLECT = /^mcp__plugin_feedback_feedback__collect_feedback$/;

const isPrompt = entry =>
  entry.type === 'user' &&
  !entry.isMeta &&
  (typeof entry.message?.content === 'string' ||
    (Array.isArray(entry.message?.content) &&
      entry.message.content.some(part => part.type === 'text') &&
      !entry.message.content.some(part => part.type === 'tool_result')));

// The previous turn: its final assistant text, and whether it already called the feedback tools.
// The prompt being submitted may or may not be in the transcript yet, so a prompt seen before any
// assistant entry is skipped.
function lastTurn(lines) {
  let text = null;
  let logged = false;
  let seenAssistant = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry.type === 'assistant' && !entry.isSidechain) {
      seenAssistant = true;
      for (const part of entry.message?.content ?? []) {
        if (part.type === 'tool_use' && COLLECT.test(part.name)) logged = true;
      }
      const parts = (entry.message?.content ?? []).filter(part => part.type === 'text');
      if (text === null && parts.length) text = parts.map(part => part.text).join('').trim() || null;
    } else if (isPrompt(entry) && seenAssistant) {
      break;
    }
  }
  return { text, logged };
}

const score = vector => vector.reduce((sum, value, i) => sum + value * MODEL.weights[i], MODEL.bias);

async function embed(text) {
  // NODE_PATH points at the plugin data dir; ESM import() ignores it, so resolve through require.
  const entry = require.resolve('@huggingface/transformers');
  const { pipeline, env } = await import(require('node:url').pathToFileURL(entry).href);
  env.cacheDir = path.join(process.env.CLAUDE_PLUGIN_DATA, 'models');
  const extract = await pipeline('feature-extraction', MODEL.model, { dtype: MODEL.dtype });
  const output = await extract(MODEL.prefix + text.slice(0, MODEL.maxChars), { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

async function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const lines = fs.readFileSync(input.transcript_path, 'utf8').split('\n').filter(Boolean);
  const { text, logged } = lastTurn(lines);
  if (!text || logged) return;
  if (score(await embed(text)) < MODEL.cutoff) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext:
          '[feedback] Your previous answer may have pointed out a gap: a doc, skill, rule, script or config that was wrong, stale or missing something, or that you had to work around. If it did and you have not logged it, call collect_feedback for it. If it did not, ignore this note.',
      },
    }),
  );
}

if (require.main === module) {
  // --prefetch runs in the background at session start so the first prompt doesn't wait ~40 s for the
  // model download. Never block the user's prompt: before the first npm install, or on any failure, stay silent.
  (process.argv[2] === '--prefetch' ? embed('warm up') : main()).catch(() => {});
}

module.exports = { lastTurn, score };
