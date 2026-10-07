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

// The mod reads this to draw a progress bar while the model downloads at session start.
const WARMUP = path.join(__dirname, '..', 'data', 'warmup.json');
const writeWarmup = state => {
  fs.mkdirSync(path.dirname(WARMUP), { recursive: true });
  // Write then rename, so the mod never reads a half-written file.
  fs.writeFileSync(`${WARMUP}.tmp`, JSON.stringify({ ...state, at: Date.now() }));
  fs.renameSync(`${WARMUP}.tmp`, WARMUP);
};

async function prefetch() {
  let last = 0;
  writeWarmup({ state: 'loading' });
  // pipeline() sizes every file up front, so progress_total carries the real total from the start.
  await embed('warm up', event => {
    if (event.status !== 'progress_total' || !event.total || Date.now() - last < 250) return;
    last = Date.now();
    writeWarmup({ state: 'downloading', loaded: event.loaded, total: event.total });
  });
  writeWarmup({ state: 'ready' });
}

async function embed(text, onProgress) {
  // NODE_PATH points at the plugin data dir; ESM import() ignores it, so resolve through require.
  const entry = require.resolve('@huggingface/transformers');
  const { pipeline, env } = await import(require('node:url').pathToFileURL(entry).href);
  // Shared by the feedback and verified plugins, so the model is downloaded and stored once.
  env.cacheDir = path.join(require('node:os').homedir(), '.claude', 'models');
  const extract = await pipeline('feature-extraction', MODEL.model, { dtype: MODEL.dtype, progress_callback: onProgress });
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
  if (process.argv[2] === '--prefetch') prefetch().catch(() => writeWarmup({ state: 'failed' }));
  else main().catch(() => {});
}

module.exports = { lastTurn, score };
