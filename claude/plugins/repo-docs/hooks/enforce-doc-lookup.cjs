#!/usr/bin/env node
'use strict';
// PreToolUse hook (matcher: Grep|Glob): if no repo-docs doc-lookup tool has been
// called yet this session, remind — once — that find_docs usually answers a
// "how do we do X here" question faster and cheaper than a broad search. Never
// blocks the tool call: additionalContext only, no permissionDecision. Silent
// once a doc-lookup tool has been used, or after the first reminder, so it never
// nags on every grep/glob for the rest of the session.
const {
  queryInject,
  hasRemindedDocLookup,
  markRemindedDocLookup,
} = require('./lib/inject-client.cjs');

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};

const main = async () => {
  let event;
  try { event = JSON.parse(await readStdin()); } catch { process.exit(0); }
  const root = event?.cwd || process.cwd();
  const session = event?.session_id;

  if (hasRemindedDocLookup(root, session)) process.exit(0);

  const res = await queryInject(root, { op: 'used-status' }, 300);
  if (!res || res.docToolUsed) process.exit(0); // no server, or already used → silent

  markRemindedDocLookup(root, session);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext:
        '[repo-docs] Before searching further by hand: find_docs (repo-docs MCP) does a semantic search ' +
        'over this repo\'s Markdown and usually answers a "how do we do X here" / "where is this configured" ' +
        'question in one call, cheaper than a broad grep/glob sweep. Prefer it for convention and doc lookups; ' +
        'grep/glob remain the right tool for a genuine code search. This is a one-time reminder for this session.',
    },
  }));
};
main().catch(() => process.exit(0));
