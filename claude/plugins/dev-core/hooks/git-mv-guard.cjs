#!/usr/bin/env node
'use strict';
// PreToolUse hook: refuse a plain `mv` of a git-tracked file.
//
// Guidance alone did not hold here: `git mv` is the kind of rule that is read at
// session start and forgotten at the moment it matters, and a plain `mv` plus
// `git add` records the move as a delete and an add, losing the history link. This
// is the one rule in the set that a hook can enforce outright rather than remind
// about, so it denies the call and names the command to run instead.
//
// The command is split on unquoted `&&`, `||`, `;`, `|`, and newlines first, and every
// segment is checked. Measured: asked to rename a tracked file, the model wrote
// `mv src/utils.js src/helpers.js && sed -i '' ... && echo ...` on the first try, so a
// guard that only matched a whole-command `mv` never fired once.
//
// Within a segment it denies only what it can parse with confidence: a two-argument
// `mv`, with optional short flags, whose source is tracked in the git repo at the
// session's cwd. Anything else runs: globs, multi-source moves, untracked or ignored
// sources, temp paths, and any directory that is not a git work tree. A false deny
// costs the user a blocked command, so the parser stays narrow.
//
// Every failure path exits 0 with no output; a guard that errors must not take the
// tool call down with it.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};

const unquote = (s) => s.replace(/^(['"])(.*)\1$/, '$2');

// Split a shell command into its top-level segments, respecting quotes so that a
// `sed -i '' "s|a|b|" f` does not split on the pipes inside its own argument.
function segments(command) {
  const out = [];
  let buf = '';
  let quote = '';
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote) {
      buf += c;
      if (c === quote && command[i - 1] !== '\\') quote = '';
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') { out.push(buf); buf = ''; i += 1; continue; }
    if (c === ';' || c === '|' || c === '&' || c === '\n') { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

// A bare `mv SRC DEST`, optionally with one group of short flags. Deliberately
// anchored: anything with a redirect, a glob, or a third argument falls through.
function parsePlainMv(command) {
  if (typeof command !== 'string') return null;
  const m = command.trim().match(
    /^mv(?:\s+-[a-zA-Z]+)?\s+("(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)*'|[^\s*?[\]|&;<>$`]+)\s+("(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)*'|[^\s*?[\]|&;<>$`]+)\s*$/,
  );
  if (!m) return null;
  const src = unquote(m[1]);
  const dest = unquote(m[2]);
  // Scratch and temp paths are never the repo's history.
  if (/^(\/tmp\/|\/var\/folders\/|\/private\/tmp\/)/.test(src)) return null;
  return { src, dest };
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

const main = async () => {
  let event = {};
  try { event = JSON.parse(await readStdin()); } catch { return; }
  if (event.tool_name !== 'Bash') return;

  const command = event.tool_input && event.tool_input.command;
  if (typeof command !== 'string') return;
  let parsed = null;
  for (const segment of segments(command)) {
    parsed = parsePlainMv(segment);
    if (parsed) break;
  }
  if (!parsed) return;

  const cwd = event.cwd || process.cwd();
  try {
    if (git(cwd, ['rev-parse', '--is-inside-work-tree']).trim() !== 'true') return;
  } catch {
    return; // not a git repo, or no git on PATH
  }

  // `ls-files --error-unmatch` exits non-zero for anything git is not tracking,
  // which covers both untracked and ignored files.
  const src = path.resolve(cwd, parsed.src);
  try {
    git(cwd, ['ls-files', '--error-unmatch', '--', src]);
  } catch {
    return; // untracked or ignored: a plain mv is correct
  }

  const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `${parsed.src} is tracked by git. A plain mv records this as a delete plus an ` +
        `add, which loses the file's history and hides the rename in the diff. Run ` +
        `\`git mv ${quote(parsed.src)} ${quote(parsed.dest)}\` instead.`,
    },
  }));
};
main().catch(() => process.exit(0));
