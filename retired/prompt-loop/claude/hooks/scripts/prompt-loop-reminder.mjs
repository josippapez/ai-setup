#!/usr/bin/env node

// UserPromptSubmit hook: nudges the assistant to close the turn by checking in
// with the user. Throttled to one reminder per window per session — it used to
// fire on every prompt, every Edit/Write, and every session start, which buried
// the signal in noise. Fails open: if state can't be read or written, remind.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

const REMINDER =
  '[claude-hook][prompt-loop] Reminder: close the turn with the deliverable as its final plain text, then ask the user whether they want any changes.';

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const parseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

function windowMs() {
  const raw = Number.parseInt(process.env.PROMPT_LOOP_REMINDER_INTERVAL_MS ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_INTERVAL_MS;
}

function sessionKey(event) {
  const id = event?.session_id ?? event?.sessionId ?? 'default';
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
}

const main = async () => {
  const event = parseJson(await readStdin());
  const now = Date.now();

  let statePath;
  let last = 0;
  try {
    const dir =
      process.env.PROMPT_LOOP_STATE_DIR || path.join(os.tmpdir(), 'claude-prompt-loop');
    fs.mkdirSync(dir, { recursive: true });
    statePath = path.join(dir, `${sessionKey(event)}.json`);
    last = Number(JSON.parse(fs.readFileSync(statePath, 'utf8')).last) || 0;
  } catch {
    // First prompt of the session, or an unusable state dir — remind either way.
  }

  if (last && now - last < windowMs()) process.exit(0);

  try {
    if (statePath) fs.writeFileSync(statePath, JSON.stringify({ last: now }));
  } catch {
    // Reminding matters more than recording that we reminded.
  }

  console.log(REMINDER);
};

await main();
