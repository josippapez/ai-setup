#!/usr/bin/env node
'use strict';
// journal: `snapshot` on UserPromptSubmit records the working tree; `record` on Stop
// describes what the turn changed, appends it to this repo's journal and, inside Wings,
// to the session's open issue; `inject` on SessionStart shows the last entries.
// None of it depends on the main model remembering to do it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const dataDir = process.env.CLAUDE_PLUGIN_DATA || path.join(__dirname, '..', 'data');
const sessionsDir = path.join(dataDir, 'sessions');
const journalDir = path.join(dataDir, 'journal');
const describer = path.join(dataDir, 'describe');
const STALE_MS = 60 * 60 * 1000;
const MAX_FILES = 8;
const DIFF_CAP = 1500; // Apple's on-device model has a 4,096-token context
const INJECT = 3;
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'uv.lock', 'composer.lock', 'go.sum', 'Package.resolved', 'flake.lock']);

function git(cwd, args, input) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function tree(cwd) {
  const top = (git(cwd, ['rev-parse', '--show-toplevel']) || '').trim();
  if (!top) return null;
  const head = (git(cwd, ['rev-parse', 'HEAD']) || '').trim() || null;
  const status = git(top, ['status', '--porcelain', '--no-renames', '-uall', '-z']) || '';
  const files = {};
  const present = [];
  for (const entry of status.split('\0')) {
    if (!entry) continue;
    const rel = entry.slice(3);
    if (entry[0] === 'D' || entry[1] === 'D') files[rel] = 'deleted';
    else present.push(rel);
  }
  if (present.length) {
    // -w stores the blobs so record can diff the prompt-time content later.
    const hashes = (git(top, ['hash-object', '-w', '--stdin-paths'], present.join('\n') + '\n') || '').trim().split('\n');
    present.forEach((rel, i) => { files[rel] = hashes[i] || 'unreadable'; });
  }
  return { top, head, files };
}

function blobAt(top, rev, rel) {
  const out = rev && git(top, ['rev-parse', `${rev}:${rel}`]);
  return out ? out.trim() : 'deleted';
}

function changedFiles(before, after) {
  const top = after.top;
  const current = rel => (rel in after.files ? after.files[rel] : blobAt(top, after.head, rel));
  const original = rel => (rel in before.files ? before.files[rel] : blobAt(top, before.head, rel));
  const candidates = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  if (before.head && after.head && before.head !== after.head) {
    for (const rel of (git(top, ['diff', '--name-only', before.head, after.head]) || '').split('\n')) if (rel) candidates.add(rel);
  }
  return [...candidates].sort()
    .map(rel => ({ rel, from: original(rel), to: current(rel) }))
    .filter(f => f.from !== f.to && !LOCKFILES.has(path.basename(f.rel)));
}

function diffOf(top, f) {
  const empty = git(top, ['hash-object', '-t', 'blob', '/dev/null']).trim();
  const a = f.from === 'deleted' ? empty : f.from;
  const b = f.to === 'deleted' ? empty : f.to;
  const out = git(top, ['diff', '--no-color', '--unified=0', a, b]) || '';
  return out.split('\n').filter(l => !/^(diff --git|index |--- |\+\+\+ )/.test(l)).join('\n');
}

function stat(diff) {
  const lines = diff.split('\n');
  return `+${lines.filter(l => l.startsWith('+')).length} -${lines.filter(l => l.startsWith('-')).length}`;
}

// One line per file from the on-device model, or the line counts when it is not there.
function describe(top, files) {
  const items = files.map(f => ({ path: f.rel, diff: diffOf(top, f), new: f.from === 'deleted', gone: f.to === 'deleted' }));
  const lines = new Map();
  // Given no diff text (binary, mode-only, empty) the model invents a change, so it never sees one.
  const describable = items.filter(i => !i.gone && /^[+-]/m.test(i.diff));
  if (describable.length && fs.existsSync(describer)) {
    try {
      const out = execFileSync(describer, [], {
        input: JSON.stringify({ files: describable.map(i => ({ path: i.path, diff: i.diff.slice(0, DIFF_CAP), new: i.new })) }),
        encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'ignore'],
      });
      for (const l of out.split('\n')) {
        const tab = l.indexOf('\t');
        if (tab > 0 && l.slice(tab + 1).trim()) lines.set(l.slice(0, tab), l.slice(tab + 1).trim());
      }
    } catch {}
  }
  const cap = s => (s.length > 200 ? s.slice(0, 199) + '…' : s);
  return items.map(i => ({ path: i.path, what: i.gone ? 'deleted' : cap((i.new ? 'new: ' : '') + (lines.get(i.path) || `${i.new ? 'added' : 'changed'} (${stat(i.diff)})`)) }));
}

const slug = s => s.replace(/[^\w.-]/g, '_');
const snapshotFile = session => path.join(sessionsDir, `${slug(session)}.json`);
const journalFile = top => path.join(journalDir, `${slug(top)}.jsonl`);

function snapshot(ev) {
  const file = snapshotFile(ev.session_id);
  let snap = null;
  try {
    snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  if (snap && Date.now() - snap.ts < STALE_MS) {
    snap.prompts.push(ev.prompt || '');
  } else {
    const t = tree(ev.cwd);
    if (!t) return;
    snap = { ts: Date.now(), prompts: [ev.prompt || ''], ...t };
  }
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snap));
}

// The Wings MCP, reached the way Claude Code reaches it, so Wings ties the call to
// this pane and its session. Only inside a Wings pane with the server registered.
function wingsCommand() {
  if (!process.env.WINGS_PANE_ID) return null;
  try {
    const w = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')).mcpServers?.wings;
    return w?.command ? [w.command, w.args || []] : null;
  } catch {
    return null;
  }
}

function wingsCalls(calls) {
  const cmd = wingsCommand();
  if (!cmd) return Promise.resolve([]);
  return new Promise(resolve => {
    const child = spawn(cmd[0], cmd[1], { stdio: ['pipe', 'pipe', 'ignore'] });
    const results = new Map();
    let buf = '';
    const done = () => { clearTimeout(timer); child.kill(); resolve(calls.map((_, i) => results.get(i + 2) ?? null)); };
    const timer = setTimeout(done, 15000);
    child.on('error', done);
    child.stdout.on('data', chunk => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const msg = JSON.parse(line);
          if (msg.id >= 2) results.set(msg.id, msg.result?.isError ? null : (msg.result?.content || []).map(c => c.text).join('\n'));
        } catch {}
        if (results.size === calls.length) done();
      }
    });
    const send = m => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'journal', version: '0.1.0' } } });
    send({ method: 'notifications/initialized' });
    calls.forEach((c, i) => send({ id: i + 2, method: 'tools/call', params: { name: c.name, arguments: c.args } }));
  });
}

// The open issue this session worked on last, the same rule Issues uses at session start,
// limited to In progress and In review so a finished issue does not collect new notes.
async function sessionIssue(session) {
  const lists = await wingsCalls([{ name: 'tasks__list', args: { status: 'in_progress' } }, { name: 'tasks__list', args: { status: 'in_review' } }]);
  const keys = lists.join('\n').split('\n').map(l => (l.match(/^([A-Z]{1,3}-\d+) \[/) || [])[1]).filter(Boolean);
  if (!keys.length) return null;
  const issues = await wingsCalls(keys.map(key => ({ name: 'tasks__get', args: { key } })));
  let best = null;
  issues.forEach((text, i) => {
    if (!text) return;
    const m = text.match(new RegExp(`${session}[^\\n]* last seen (\\S+)`));
    if (m && (!best || m[1] > best.seen)) best = { key: keys[i], seen: m[1] };
  });
  return best?.key || null;
}

// Commits this turn made: reachable from the new HEAD but not the old one, by this
// repo's git user, committed after the prompt. Leaves out commits a pull brought in.
function turnCommits(snap, now) {
  if (!snap.head || !now.head || snap.head === now.head) return [];
  const me = (git(now.top, ['config', 'user.email']) || '').trim();
  const out = git(now.top, ['log', '--reverse', '--max-count=20', '--format=%H %ae %ct', `${snap.head}..${now.head}`]) || '';
  return out.split('\n').map(l => l.split(' '))
    .filter(([h, email, ct]) => h && email === me && Number(ct) * 1000 >= snap.ts - 60000)
    .map(([h]) => h.slice(0, 12));
}

async function record(ev) {
  const file = snapshotFile(ev.session_id);
  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  fs.unlinkSync(file);
  const now = tree(snap.top);
  if (!now) return;
  const changed = changedFiles(snap, now);
  const commits = turnCommits(snap, now);
  if (!changed.length && !commits.length) return;
  const files = describe(now.top, changed.slice(0, MAX_FILES));
  const more = changed.length - files.length;
  if (files.length) {
    const entry = { ts: new Date().toISOString(), session: ev.session_id, prompt: snap.prompts[0].slice(0, 200), files, ...(more > 0 ? { more } : {}), ...(commits.length ? { commits } : {}) };
    fs.mkdirSync(journalDir, { recursive: true });
    fs.appendFileSync(journalFile(now.top), JSON.stringify(entry) + '\n');
  }
  const key = await sessionIssue(ev.session_id);
  if (!key) return;
  // Issues adds a commit only once, so linking one the model already linked is a no-op.
  const calls = commits.map(commit => ({ name: 'tasks__update', args: { key, commit } }));
  if (files.length) {
    const text = ['Changed this turn (written by the journal hook from the diff):', ...files.map(f => `- \`${f.path}\`: ${f.what}`), ...(more > 0 ? [`- and ${more} more`] : [])].join('\n');
    calls.push({ name: 'tasks__log', args: { key, text } });
  }
  await wingsCalls(calls);
}

const STALE_DAYS = 3;

// Facts about open issues the session should know before it starts: one untouched for
// days, or this session's todo finished while its issue is still open. The hook only
// reports them; changing a status stays with the model or the person.
async function staleLines() {
  const [inProgress, inReview, todo] = await wingsCalls([
    { name: 'tasks__list', args: { status: 'in_progress' } },
    { name: 'tasks__list', args: { status: 'in_review' } },
    { name: 'tasks__todo', args: {} },
  ]);
  const lines = [];
  const open = new Map();
  for (const l of [inProgress, inReview].join('\n').split('\n')) {
    const m = l.match(/^([A-Z]{1,3}-\d+) \[(\w+)\] .* \(updated (\d{4}-\d\d-\d\dT\d\d:\d\d)Z\)$/);
    if (!m) continue;
    open.set(m[1], m[2]);
    const days = Math.floor((Date.now() - Date.parse(`${m[3]}:00Z`)) / 86400000);
    if (days >= STALE_DAYS) lines.push(`${m[1]} is ${m[2]} but unchanged for ${days} days.`);
  }
  const t = (todo || '').match(/^Todo for this session \(([A-Z]{1,3}-\d+)\): (\d+) of (\d+) done\./);
  if (t && t[2] === t[3] && open.has(t[1])) lines.push(`Every step of this session's todo for ${t[1]} is done, but ${t[1]} is still ${open.get(t[1])}.`);
  return lines;
}

async function inject(ev) {
  const top = (git(ev.cwd, ['rev-parse', '--show-toplevel']) || '').trim();
  if (!top) return;
  let rows = [];
  try {
    rows = fs.readFileSync(journalFile(top), 'utf8').trim().split('\n').slice(-INJECT).map(l => JSON.parse(l));
  } catch {}
  const lines = [];
  if (rows.length) {
    lines.push('[journal] What the last turns in this repo changed, described from their diffs. Read the file before relying on a line.');
    for (const r of rows) {
      lines.push(`${r.ts.slice(0, 16).replace('T', ' ')} "${r.prompt.replace(/\s+/g, ' ').slice(0, 80)}"`);
      for (const f of r.files) lines.push(`  - ${f.path}: ${f.what}`);
      if (r.more) lines.push(`  - and ${r.more} more`);
    }
  }
  const stale = await staleLines();
  if (stale.length) lines.push('[journal] Issue status to check. The hook only reports it; fix it with tasks__update if it is wrong:', ...stale.map(l => `  - ${l}`));
  if (!lines.length) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } }));
}

// Compiles the describer once per change of its source. macOS with the on-device model only.
function build() {
  const src = path.join(__dirname, 'describe.swift');
  const stamp = path.join(dataDir, 'describe.src');
  const source = fs.readFileSync(src, 'utf8');
  try {
    if (fs.readFileSync(stamp, 'utf8') === source && fs.existsSync(describer)) return;
  } catch {}
  if (process.platform !== 'darwin') return;
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    execFileSync('swiftc', ['-O', '-parse-as-library', src, '-o', describer], { stdio: 'ignore', timeout: 300000 });
    fs.writeFileSync(stamp, source);
  } catch {}
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'build') return build();
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const ev = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!ev.session_id || !ev.cwd) return;
  if (mode === 'snapshot') snapshot(ev);
  else if (mode === 'record') await record(ev);
  else if (mode === 'inject') await inject(ev);
}

if (require.main === module) main().catch(() => {});

module.exports = { tree, changedFiles, describe, turnCommits };
