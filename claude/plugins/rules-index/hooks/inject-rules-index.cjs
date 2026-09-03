#!/usr/bin/env node
'use strict';
// SessionStart hook: list the rules Claude Code loads for this session.
//
// Rules without `paths:` frontmatter are already in context. Rules with `paths:`
// enter context only when Claude reads a file matching a glob, so at session start
// (and again after compaction) the model has no way to know they exist. This hook
// emits one line per rule file, from the project's .claude/rules and the user's
// ~/.claude/rules, so the model can read a scoped rule before working in its area.
// Fires on every SessionStart source (startup, resume, clear, compact).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CAP = 9000; // headroom under Claude Code's 10,000-character hook output limit

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};

function listMarkdown(dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    let isDir = e.isDirectory(), isFile = e.isFile();
    if (e.isSymbolicLink()) {
      try { const st = fs.statSync(full); isDir = st.isDirectory(); isFile = st.isFile(); } catch { continue; }
    }
    if (isDir) out.push(...listMarkdown(full));
    else if (isFile && e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');

// Minimal frontmatter reader: `name`, `description`, and `paths` as either an
// inline array or a block list. Anything else is ignored.
function frontmatter(body) {
  const fm = { name: '', description: '', paths: [] };
  const lines = body.split(/\r?\n/);
  if (lines[0] !== '---') return fm;
  let key = '';
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '---') break;
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) {
      key = m[1];
      const val = m[2];
      if (key === 'name' || key === 'description') fm[key] = unquote(val);
      else if (key === 'paths' && val.startsWith('[')) {
        fm.paths = val.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
      }
      continue;
    }
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key === 'paths') fm.paths.push(unquote(item[1]));
  }
  return fm;
}

function entry(file, shown) {
  let fm;
  try { fm = frontmatter(fs.readFileSync(file, 'utf8')); } catch { fm = frontmatter(''); }
  const label = fm.name && fm.description ? `${fm.name}: ${fm.description}` : fm.description || fm.name;
  let line = `- ${shown}`;
  if (label) line += ` — ${label}`;
  if (fm.paths.length) line += ` (paths: ${fm.paths.join(', ')})`;
  return { line, scoped: fm.paths.length > 0 };
}

const main = async () => {
  let event = {};
  try { event = JSON.parse(await readStdin()); } catch { /* no event: fall back to cwd */ }
  const cwd = event.cwd || process.cwd();
  const home = os.homedir();
  const roots = [
    { dir: path.join(cwd, '.claude', 'rules'), show: (f) => path.relative(cwd, f) },
    { dir: path.join(home, '.claude', 'rules'), show: (f) => '~/' + path.relative(home, f) },
  ];
  // The same directory reached twice (session started in $HOME) is listed once.
  if (path.resolve(roots[0].dir) === path.resolve(roots[1].dir)) roots.pop();

  const always = [], scoped = [];
  for (const r of roots) {
    for (const f of listMarkdown(r.dir)) {
      const e = entry(f, r.show(f));
      (e.scoped ? scoped : always).push(e.line);
    }
  }
  if (always.length + scoped.length === 0) process.exit(0);

  const header =
    '[rules-index] Rules Claude Code loads for this session, from .claude/rules and ~/.claude/rules. ' +
    '"Always on" rules are already in your context. "Path-scoped" rules enter context only when you read a ' +
    'file matching their paths, so before working in a matching area, read the rule file yourself.';
  const sections = [];
  if (always.length) sections.push('Always on:\n' + always.join('\n'));
  if (scoped.length) sections.push('Path-scoped:\n' + scoped.join('\n'));
  let text = header + '\n\n' + sections.join('\n\n');

  // Never let the value cross the cap: Claude Code would replace the whole thing
  // with a file path and a 2KB preview. Drop lines from the end and say so.
  if (text.length > CAP) {
    const lines = text.split('\n');
    let dropped = 0;
    while (lines.join('\n').length > CAP - 60 && lines.length > 1) {
      if (lines[lines.length - 1].startsWith('- ')) dropped++;
      lines.pop();
    }
    text = lines.join('\n') + `\n(+${dropped} more rule files not listed; list the rules directories to see them)`;
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
  }));
};
main().catch(() => process.exit(0));
