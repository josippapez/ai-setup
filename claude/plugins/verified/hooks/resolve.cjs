#!/usr/bin/env node
'use strict';
// Does a claimed path name a file that is actually there?
//
// The gate has only ever asked "did the session read this path". It never asked
// whether the path exists, so a fabricated file reference passed whenever the
// manifest happened to back something near it, and a real file was flagged
// whenever the model wrote it relative to a root that is not cwd.
//
// Resolving against cwd alone is not enough: measured over 776 turns from the
// last week, 47 path claims looked missing at cwd and 30 of them were real files
// one level up, at the git root, or elsewhere in the repo. Three tries, cheapest
// first, with the repo's tracked-file list as the backstop.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const kinds = new Map();
function kind(p) {
  if (kinds.has(p)) return kinds.get(p);
  let v;
  try { v = fs.statSync(p).isDirectory() ? 'dir' : 'file'; } catch { v = 'missing'; }
  kinds.set(p, v);
  return v;
}

const roots = new Map();
function gitRoot(cwd) {
  if (roots.has(cwd)) return roots.get(cwd);
  let r = null;
  try {
    r = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim() || null;
  } catch { r = null; }
  roots.set(cwd, r);
  return r;
}

// debt: holds the repo's whole tracked-file list in memory, and only runs when a
// claim already failed two stats. Swap for `git ls-files -- '*<tail>'` if a repo
// ever makes this expensive.
const listings = new Map();
function tracked(root) {
  if (listings.has(root)) return listings.get(root);
  let set;
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files'],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    set = new Set(out.split('\n').filter(Boolean));
  } catch { set = new Set(); }
  listings.set(root, set);
  return set;
}

function suffixHit(root, rel) {
  const files = tracked(root);
  if (files.has(rel)) return true;
  const tail = '/' + rel;
  for (const f of files) if (f.endsWith(tail)) return true;
  return false;
}

/**
 * 'file' | 'missing' | 'unknown'.
 * 'unknown' whenever there is no usable cwd, so a claim is never called
 * fabricated on the strength of not knowing where to look.
 */
function exists(span, cwd) {
  const rel = span.replace(/:\d+$/, '');
  if (!cwd || kind(cwd) !== 'dir') return 'unknown';
  if (rel.startsWith('/')) return kind(rel) === 'missing' ? 'missing' : 'file';
  if (kind(path.resolve(cwd, rel)) !== 'missing') return 'file';
  const root = gitRoot(cwd);
  if (!root) return 'missing';
  if (kind(path.resolve(root, rel)) !== 'missing') return 'file';
  return suffixHit(root, rel) ? 'file' : 'missing';
}

module.exports = { exists, kind, gitRoot };
