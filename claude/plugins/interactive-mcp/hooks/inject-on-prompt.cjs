#!/usr/bin/env node
'use strict';
const { queryInject, formatBlock, isConversationalFiller } = require('./lib/inject-client.cjs');

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

  const res = await queryInject(root, {
    query: prompt,
    limit: num(process.env.REPO_DOCS_INJECT_LIMIT, 3),
    threshold: num(process.env.REPO_DOCS_INJECT_THRESHOLD, 0.80),
  }, num(process.env.REPO_DOCS_INJECT_TIMEOUT_MS, 300));

  if (!res || !res.injected || !res.hits || !res.hits.length) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: formatBlock(res.hits) },
  }));
};
main().catch(() => process.exit(0));
