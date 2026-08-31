#!/usr/bin/env node
'use strict';

// SessionEnd hook: reap THIS session's own repo-docs MCP servers on exit.
// Claude Code doesn't always reap plugin MCP servers when a session ends, so they
// accumulate across sessions. This is a belt-and-suspenders cleanup that kills
// ONLY the standalone-mcp.cjs processes parented by this session's own process —
// never another live session's servers.
//
// Safety model: walk up from this hook's own parent to the NEAREST ancestor whose
// command carries `--session-id` (the session process that also spawned the MCP
// servers). Kill only standalone-mcp.cjs processes whose ppid is exactly that pid.
// Other sessions' servers hang off a different session pid and are never matched.

const { execFileSync } = require('node:child_process');

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};

function parsePsRows(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) rows.push({ pid: m[1], ppid: m[2], cmd: m[3] });
  }
  return rows;
}

// The nearest ancestor whose command bears `--session-id` (optionally matching a
// known id). That process is the direct parent of this session's MCP servers.
function findSessionPid({ startPpid, sessionId, cmdOf, ppidOf, maxHops = 12 }) {
  let p = String(startPpid || '').trim();
  for (let i = 0; i < maxHops && p && p !== '0' && p !== '1'; i++) {
    const cmd = cmdOf(p);
    if (cmd.includes('--session-id') && (!sessionId || cmd.includes(sessionId))) return p;
    p = String(ppidOf(p) || '').trim();
  }
  return null;
}

// standalone-mcp servers that are DIRECT children of exactly sessionPid.
function serversUnder(rows, sessionPid) {
  return rows
    .filter((r) => r.ppid === String(sessionPid) && /standalone-mcp\.cjs/.test(r.cmd))
    .map((r) => r.pid);
}

async function main() {
  let event;
  try { event = JSON.parse(await readStdin()); } catch { event = {}; }
  const ps1 = (args) => { try { return execFileSync('ps', args, { encoding: 'utf8' }).trim(); } catch { return ''; } };
  const cmdOf = (pid) => ps1(['-o', 'command=', '-p', String(pid)]);
  const ppidOf = (pid) => ps1(['-o', 'ppid=', '-p', String(pid)]);

  const sessionPid = findSessionPid({ startPpid: process.ppid, sessionId: event && event.session_id, cmdOf, ppidOf });
  if (!sessionPid) process.exit(0); // can't safely identify our session → do nothing

  const rows = parsePsRows(ps1(['-Ao', 'pid=,ppid=,command=']));
  for (const pid of serversUnder(rows, sessionPid)) {
    try { process.kill(Number(pid), 'SIGTERM'); } catch {}
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch(() => process.exit(0));
}

module.exports = { parsePsRows, serversUnder, findSessionPid };
