#!/usr/bin/env node
'use strict';
// The replay simulator, in Dream-RSI's sense (§2, p.3): a recorded history whose
// outcomes are already stored, so an alternative configuration can be scored by
// reading past records instead of re-running anything.
//
// Two files, both append-mostly:
//   ledger.jsonl   one node per evaluated turn
//   offsets.json   per-session byte offset into the transcript
//
// The offset is what keeps stage 1 cheap. Measured over 36 of this user's recent
// sessions, transcripts run a median of 0.4 MB and reach 21.4 MB, so re-reading
// from byte zero on every Stop would make the hook the slowest thing in the turn.
// Reading only what was appended since the last Stop makes the cost proportional
// to the turn, not the session.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const dir = () =>
  process.env.VERIFIED_HOME ||
  (process.env.CLAUDE_PLUGIN_DATA
    ? path.join(process.env.CLAUDE_PLUGIN_DATA, 'verified')
    : path.join(os.homedir(), '.claude', 'verified'));

const ledgerPath = () => path.join(dir(), 'ledger.jsonl');
const offsetsPath = () => path.join(dir(), 'offsets.json');

function ensure() {
  fs.mkdirSync(dir(), { recursive: true });
}

function readOffsets() {
  try { return JSON.parse(fs.readFileSync(offsetsPath(), 'utf8')); } catch { return {}; }
}

function getOffset(session) {
  const o = readOffsets()[session];
  return typeof o === 'number' ? o : 0;
}

function setOffset(session, offset) {
  ensure();
  const all = readOffsets();
  all[session] = offset;
  // Sessions accumulate forever otherwise; 500 is far more than any replay needs.
  const keys = Object.keys(all);
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete all[k];
  const tmp = offsetsPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all));
  fs.renameSync(tmp, offsetsPath());
}

// The manifest accumulates for the life of a session rather than resetting at
// each Stop. evidence-first Gate 1 is worded "a URL you fetched *this session*",
// and the per-turn version contradicted it: the gate blocked on "21 tests pass"
// two turns after the test run, and on a design file read in an earlier turn.
// One file per session, so a long session never rewrites a shared blob.
const CAP = { paths: 4000, commands: 1000, searches: 1000, urls: 500 };

const manifestPath = (session) =>
  path.join(dir(), 'manifests', String(session).replace(/[^\w.-]/g, '_') + '.json');

function readManifest(session) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath(session), 'utf8'));
    return {
      paths: new Set(m.paths || []),
      commands: m.commands || [],
      searches: m.searches || [],
      urls: new Set(m.urls || []),
      libLookup: !!m.libLookup,
    };
  } catch {
    return { paths: new Set(), commands: [], searches: [], urls: new Set(), libLookup: false };
  }
}

function writeManifest(session, ev) {
  try {
    fs.mkdirSync(path.join(dir(), 'manifests'), { recursive: true });
    // Keep the most recent entries when a session runs long; the oldest evidence
    // is the least likely to be what a current claim rests on.
    const p = manifestPath(session);
    fs.writeFileSync(p + '.tmp', JSON.stringify({
      paths: [...ev.paths].slice(-CAP.paths),
      commands: ev.commands.slice(-CAP.commands),
      searches: ev.searches.slice(-CAP.searches),
      urls: [...ev.urls].slice(-CAP.urls),
      libLookup: ev.libLookup,
    }));
    fs.renameSync(p + '.tmp', p);
  } catch { /* a lost manifest costs precision on one turn, never the turn */ }
}

function append(node) {
  ensure();
  fs.appendFileSync(ledgerPath(), JSON.stringify(node) + '\n');
}

function read() {
  try {
    return fs.readFileSync(ledgerPath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Mark the previous node for this session with whether the block actually changed
// anything. This is the field that separates a true catch from a false positive,
// and it is the only reason the ledger is worth storing.
function resolvePrevious(session, currentSpans) {
  const all = read();
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const n = all[i];
    if (n.session !== session) continue;
    if (n.action !== 'block' || typeof n.resolved === 'boolean') return;
    const before = new Set((n.claims || []).map((c) => c.span));
    n.resolved = ![...before].some((s) => currentSpans.has(s));
    try {
      fs.writeFileSync(ledgerPath(), all.map((x) => JSON.stringify(x)).join('\n') + '\n');
    } catch { /* a lost resolution costs one replay data point, never the turn */ }
    return;
  }
}

module.exports = { dir, ledgerPath, offsetsPath, getOffset, setOffset, readManifest, writeManifest, append, read, resolvePrevious };
