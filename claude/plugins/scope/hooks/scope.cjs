#!/usr/bin/env node
'use strict';
// scope: `snapshot` on UserPromptSubmit records the working tree, `check` on Stop
// diffs it and tells the person which changed files neither the request nor the
// answer names.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dataDir = process.env.CLAUDE_PLUGIN_DATA || path.join(__dirname, '..', 'data');
const sessionsDir = path.join(dataDir, 'sessions');
// A snapshot older than this is from a turn whose Stop never fired (Ctrl-C, crash),
// so a new prompt replaces it instead of blaming the model for the gap.
const STALE_MS = 60 * 60 * 1000;
const LIST_CAP = 20;

function git(cwd, args, input) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

// HEAD plus a content hash for every modified or untracked file, or null outside a repo.
function tree(cwd) {
  if (!git(cwd, ['rev-parse', '--show-toplevel'])) return null;
  const head = (git(cwd, ['rev-parse', 'HEAD']) || '').trim() || null;
  const status = git(cwd, ['status', '--porcelain', '--no-renames', '-uall', '-z']) || '';
  const files = {};
  const present = [];
  for (const entry of status.split('\0')) {
    if (!entry) continue;
    const rel = entry.slice(3);
    if (entry[1] === 'D' || entry[0] === 'D') files[rel] = 'deleted';
    else present.push(rel);
  }
  // hash-object follows a symlink and would store whatever it points at, even outside
  // the repo, so a link is hashed by its target text, the way git stores it.
  for (const rel of [...present]) {
    let st = null;
    try { st = fs.lstatSync(path.join(cwd, rel)); } catch {}
    if (st?.isFile()) continue;
    present.splice(present.indexOf(rel), 1);
    if (st?.isSymbolicLink()) files[rel] = (git(cwd, ['hash-object', '-w', '--stdin'], fs.readlinkSync(path.join(cwd, rel))) || '').trim() || 'unreadable';
  }
  if (present.length) {
    // -w stores the blobs so versionOnly can diff them later.
    const hashes = (git(cwd, ['hash-object', '-w', '--stdin-paths'], present.join('\n') + '\n') || '').trim().split('\n');
    present.forEach((rel, i) => { files[rel] = hashes[i] || 'unreadable'; });
  }
  return { head, files };
}

function blobAt(cwd, rev, rel) {
  const out = rev && git(cwd, ['rev-parse', `${rev}:${rel}`]);
  return out ? out.trim() : 'deleted';
}

// Content at Stop against content at the prompt, so committing what was already in
// the tree is not a change, and a file changed then committed still is.
function changedFiles(before, after, cwd) {
  const current = rel => (rel in after.files ? after.files[rel] : blobAt(cwd, after.head, rel));
  const original = rel => (rel in before.files ? before.files[rel] : blobAt(cwd, before.head, rel));
  const candidates = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  if (before.head && after.head && before.head !== after.head) {
    for (const rel of (git(cwd, ['diff', '--name-only', before.head, after.head]) || '').split('\n')) if (rel) candidates.add(rel);
  }
  return [...candidates].sort().map(rel => ({ rel, from: original(rel), to: current(rel) })).filter(f => f.from !== f.to);
}

const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'uv.lock', 'composer.lock', 'go.sum', 'Package.resolved', 'flake.lock']);

// A release bump: every changed line is the same line with a different version number.
function versionOnly(cwd, f) {
  if (f.from === 'deleted' || f.to === 'deleted') return false;
  const lines = (git(cwd, ['diff', '--no-color', f.from, f.to]) || '').split('\n').filter(l => /^[+-](?![+-]{2})/.test(l));
  // Pairwise in diff order, and the token is a plain semver, so a reordered line or a
  // "1.2.3-anything" suffix is not taken for a bump.
  const strip = l => l.slice(1).replace(/\b\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?\b/g, 'V');
  const minus = lines.filter(l => l[0] === '-').map(strip);
  const plus = lines.filter(l => l[0] === '+').map(strip);
  return minus.length > 0 && minus.length === plus.length && minus.every((l, i) => l === plus[i] && l.includes('V'));
}

// Named by path, by basename, or by an ancestor directory written as one ("src/"),
// not as the start of a sibling's path: naming src/a.ts does not name src/b.ts.
function named(text, rel) {
  if (text.includes(rel) || text.includes(path.basename(rel))) return true;
  let dir = path.dirname(rel);
  while (dir && dir !== '.') {
    if (new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/(?![\\w.-])').test(text)) return true;
    dir = path.dirname(dir);
  }
  return false;
}

function snapshotFile(session) {
  return path.join(sessionsDir, `${session.replace(/[^\w.-]/g, '_')}.json`);
}

function snapshot(ev) {
  const file = snapshotFile(ev.session_id);
  let snap = null;
  try {
    snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  // A prompt sent mid-turn keeps the turn's snapshot and only adds its text.
  if (snap && Date.now() - snap.ts < STALE_MS) {
    snap.prompts.push(ev.prompt || '');
  } else {
    const t = tree(ev.cwd);
    if (!t) return;
    snap = { ts: Date.now(), cwd: ev.cwd, prompts: [ev.prompt || ''], ...t };
  }
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snap));
}

function check(ev) {
  const file = snapshotFile(ev.session_id);
  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  fs.unlinkSync(file);
  const now = tree(snap.cwd);
  if (!now) return;
  const changed = changedFiles(snap, now, snap.cwd);
  const text = snap.prompts.join('\n') + '\n' + (ev.last_assistant_message || '');
  const unnamed = changed
    .filter(f => !named(text, f.rel) && !LOCKFILES.has(path.basename(f.rel)) && !versionOnly(snap.cwd, f))
    .map(f => f.rel);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(path.join(dataDir, 'ledger.jsonl'), JSON.stringify({
    ts: new Date().toISOString(), session: ev.session_id, cwd: snap.cwd, changed: changed.map(f => f.rel), unnamed, action: unnamed.length ? 'note' : 'pass',
  }) + '\n');
  if (!unnamed.length) return;
  const shown = unnamed.slice(0, LIST_CAP).join(', ') + (unnamed.length > LIST_CAP ? `, +${unnamed.length - LIST_CAP} more` : '');
  // Shown to the person only. A block here forced an explanation on every in-scope
  // file the answer described in prose, and never once pointed at a ride-along.
  process.stdout.write(JSON.stringify({ systemMessage: `scope: changed but not named: ${shown}` }));
}

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const ev = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!ev.session_id || !ev.cwd) return;
  if (process.argv[2] === 'snapshot') snapshot(ev);
  else if (process.argv[2] === 'check') check(ev);
}

if (require.main === module) main().catch(() => {});

module.exports = { tree, changedFiles, named };
