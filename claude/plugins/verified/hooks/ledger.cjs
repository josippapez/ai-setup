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

// Not the plugin data dir: that survives a plugin update but not an uninstall,
// and it reaches the hook only as an env var the CLI never sees, which is how
// /verified-replay read an empty ledger while the hook wrote a full one. The
// ledger is the gate's only ground truth, so it lives where nothing that
// manages plugins will touch it.
const dir = () => process.env.VERIFIED_HOME || path.join(os.homedir(), '.claude', 'verified');

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
// Sized against the two largest real sessions on this machine: 1666 paths and
// 1113 commands (Sciensus NX 6c0aa781, dts_restore 4beb4f06). The old commands
// cap of 1000 clipped both. Command text is truncated because the only thing
// that reads it is a regex matching the program name at the front, and storing
// it whole made commands 610-739 KB of an ~800 KB manifest.
const CAP = { paths: 8000, printed: 8000, commands: 5000, searches: 5000, urls: 500, cmdChars: 300 };

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
      stamps: m.stamps || {},
      printed: new Set(m.printed || []),
      seq: m.seq || 0,
      lastWrite: m.lastWrite || 0,
      testOut: m.testOut || 0,
    };
  } catch {
    return { paths: new Set(), commands: [], searches: [], urls: new Set(), libLookup: false, stamps: {}, printed: new Set(), seq: 0, lastWrite: 0, testOut: 0 };
  }
}

function writeManifest(session, ev) {
  try {
    fs.mkdirSync(path.join(dir(), 'manifests'), { recursive: true });
    // Keep the most recent entries when a session runs long; the oldest evidence
    // is the least likely to be what a current claim rests on.
    const p = manifestPath(session);
    const paths = [...ev.paths].slice(-CAP.paths);
    // Stamps follow their paths out, or they accumulate for files no longer tracked.
    const stamps = {};
    for (const k of paths) if (ev.stamps[k] !== undefined) stamps[k] = ev.stamps[k];
    fs.writeFileSync(p + '.tmp', JSON.stringify({
      paths,
      commands: ev.commands.slice(-CAP.commands).map((c) => ({ ...c, cmd: c.cmd.slice(0, CAP.cmdChars) })),
      searches: ev.searches.slice(-CAP.searches),
      urls: [...ev.urls].slice(-CAP.urls),
      libLookup: ev.libLookup,
      stamps,
      printed: [...(ev.printed || [])].slice(-CAP.printed),
      seq: ev.seq,
      lastWrite: ev.lastWrite,
      testOut: ev.testOut || 0,
    }));
    fs.renameSync(p + '.tmp', p);
  } catch { /* a lost manifest costs precision on one turn, never the turn */ }
}

function append(node) {
  ensure();
  fs.appendFileSync(ledgerPath(), JSON.stringify(node) + '\n');
  if (!node.session) return;
  // The Stop hook needs only this session's last node and recent blocks. Reading them
  // back from the ledger cost 1.2-1.8 s and 1.7 GB per Stop once it reached 386 MB.
  const state = readState(node.session);
  const spans = (node.claims || []).map((c) => c.span);
  state.last = { ts: node.ts, action: node.action, spans };
  if (node.action === 'block') state.blocks = [...(state.blocks || []), spans].slice(-5);
  writeState(node.session, state);
}

const statePath = (session) =>
  path.join(dir(), 'sessions', String(session).replace(/[^\w.-]/g, '_') + '.json');

function readState(session) {
  try { return JSON.parse(fs.readFileSync(statePath(session), 'utf8')); } catch { return {}; }
}

function writeState(session, state) {
  try {
    fs.mkdirSync(path.dirname(statePath(session)), { recursive: true });
    fs.writeFileSync(statePath(session) + '.tmp', JSON.stringify(state));
    fs.renameSync(statePath(session) + '.tmp', statePath(session));
  } catch { /* costs one resolution or repeat count, never the turn */ }
}

// Spans of this session's most recent blocks, oldest first.
const recentBlocks = (session) => readState(session).blocks || [];

// Resolutions are appended as { op: 'resolve' } lines and merged here, so the Stop
// hook never rewrites the ledger under another session's append.
function read() {
  let nodes;
  try {
    nodes = fs.readFileSync(ledgerPath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
  const resolved = new Map();
  for (const n of nodes) if (n.op === 'resolve') resolved.set(`${n.session}\0${n.ts}`, n.resolved);
  return nodes
    .filter((n) => n.op !== 'resolve')
    .map((n) => {
      const r = resolved.get(`${n.session}\0${n.ts}`);
      return typeof r === 'boolean' && typeof n.resolved !== 'boolean' ? { ...n, resolved: r } : n;
    });
}

// Mark the previous node for this session with whether the block actually changed
// anything. This is the field that separates a true catch from a false positive,
// and it is the only reason the ledger is worth storing.
function resolvePrevious(session, currentSpans) {
  const state = readState(session);
  const last = state.last;
  if (!last || last.action !== 'block' || typeof last.resolved === 'boolean') return;
  last.resolved = !last.spans.some((s) => currentSpans.has(s));
  try {
    ensure();
    fs.appendFileSync(ledgerPath(), JSON.stringify({ op: 'resolve', session, ts: last.ts, resolved: last.resolved }) + '\n');
  } catch { /* a lost resolution costs one replay data point, never the turn */ }
  writeState(session, state);
}

module.exports = { dir, ledgerPath, offsetsPath, getOffset, setOffset, readManifest, writeManifest, append, read, resolvePrevious, recentBlocks };
