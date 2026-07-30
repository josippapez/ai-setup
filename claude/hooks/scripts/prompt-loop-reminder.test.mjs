import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { test } from 'node:test';

const HOOK = path.join(import.meta.dirname, 'prompt-loop-reminder.mjs');

function runHook(event, env = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      'node',
      [HOOK],
      { encoding: 'utf8', env: { ...process.env, ...env } },
      (_err, stdout) => resolve(stdout),
    );
    child.stdin.end(JSON.stringify(event));
  });
}

function freshStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-loop-state-'));
}

test('reminds once per throttle window, not on every prompt', async () => {
  const env = { PROMPT_LOOP_STATE_DIR: freshStateDir() };
  const event = { hook_event_name: 'UserPromptSubmit', session_id: 'session-a' };

  const first = await runHook(event, env);
  const second = await runHook(event, env);
  const third = await runHook(event, env);

  assert.match(first, /prompt-loop/, 'first prompt of a session must remind');
  assert.strictEqual(second, '', 'second prompt inside the window must stay silent');
  assert.strictEqual(third, '', 'still silent inside the window');
});

test('reminds again once the throttle window has elapsed', async () => {
  const env = {
    PROMPT_LOOP_STATE_DIR: freshStateDir(),
    PROMPT_LOOP_REMINDER_INTERVAL_MS: '0',
  };
  const event = { hook_event_name: 'UserPromptSubmit', session_id: 'session-b' };

  assert.match(await runHook(event, env), /prompt-loop/);
  assert.match(await runHook(event, env), /prompt-loop/, 'zero window means every prompt reminds');
});

test('throttles per session, so a second session still gets its first reminder', async () => {
  const env = { PROMPT_LOOP_STATE_DIR: freshStateDir() };

  const a = await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'session-c' }, env);
  const b = await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'session-d' }, env);

  assert.match(a, /prompt-loop/);
  assert.match(b, /prompt-loop/, 'a different session has its own window');
});

test('reminder text references no retired policy', async () => {
  const out = await runHook(
    { hook_event_name: 'UserPromptSubmit', session_id: 'session-e' },
    { PROMPT_LOOP_STATE_DIR: freshStateDir() },
  );

  // The prompt-user skill and the user-interaction / interactive-prompt-loop rules
  // were retired to retired/prompt-loop/; the hook must not cite them any more.
  assert.doesNotMatch(out, /satisfaction/i);
  assert.doesNotMatch(out, /Interactively Prompt user after/i);
  assert.doesNotMatch(out, /todo/i);
  assert.match(out, /plain text/i, 'should point at the live deliverable-visibility rule');
});

test('survives an unreadable state dir instead of breaking the prompt', async () => {
  const out = await runHook(
    { hook_event_name: 'UserPromptSubmit', session_id: 'session-f' },
    { PROMPT_LOOP_STATE_DIR: '/proc/nonexistent-cannot-create' },
  );

  assert.match(out, /prompt-loop/, 'a state-write failure must not silence the hook');
});
