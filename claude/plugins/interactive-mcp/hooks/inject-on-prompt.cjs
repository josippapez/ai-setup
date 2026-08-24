#!/usr/bin/env node
'use strict';
const { queryInjectWithWarmRetry, formatBlock, isConversationalFiller, filterFreshHits } = require('./lib/inject-client.cjs');

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const main = async () => {
  let event;
  try { event = JSON.parse(await readStdin()); } catch { process.exit(0); }
  const prompt = String(event?.prompt || '').trim();
  const root = event?.cwd || process.cwd();
  if (prompt.replace(/[^a-zA-Z]/g, '').length < 8) process.exit(0); // skip trivial
  if (isConversationalFiller(prompt)) process.exit(0);

  // Bounded wait for a cold embedder (~750ms worst case, default 3 x 250ms) so the
  // FIRST prompt of a fresh/resumed session still gets its docs instead of silently
  // missing them. Costs nothing once warm, or when no server is listening.
  const res = await queryInjectWithWarmRetry(root, {
    query: prompt,
    limit: num(process.env.REPO_DOCS_INJECT_LIMIT, 3),
    threshold: num(process.env.REPO_DOCS_INJECT_THRESHOLD, 0.80),
  }, num(process.env.REPO_DOCS_INJECT_TIMEOUT_MS, 300), {
    attempts: num(process.env.REPO_DOCS_INJECT_WARM_ATTEMPTS, 3),
    delayMs: num(process.env.REPO_DOCS_INJECT_WARM_DELAY_MS, 250),
  });

  if (!res || !res.injected || !res.hits || !res.hits.length) process.exit(0);

  // Without this the same handful of docs is re-injected on every single message.
  const fresh = filterFreshHits(root, event?.session_id, res.hits,
    num(process.env.REPO_DOCS_INJECT_REPEAT_AFTER, 20));
  if (fresh.length === 0) process.exit(0);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: formatBlock(fresh) },
  }));
};
main().catch(() => process.exit(0));
