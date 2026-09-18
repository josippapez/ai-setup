#!/usr/bin/env node
'use strict';
// Stage 5: score a policy against recorded history without re-running anything.
//
// This is Dream-RSI's dreaming step (§3, p.5-6). Candidate policies are evaluated
// by replaying them over completed discovery trees, and the paper's guarantee is
// that the current policy stays in the candidate set, so the version that ships
// can never score worse (V^{m*} >= V^0, p.6). That is enforced here: a candidate
// below the current config is rejected, not merged.
//
// Two sources of worlds:
//   --corpus [N]  turns from the N most recent real transcripts (default 120)
//   (default)     the gate's own ledger, once it has enough nodes to mean anything
//
// Usage:
//   node replay.cjs --pin [N]             freeze the world set (append-only)
//   node replay.cjs --corpus              score the current config
//   node replay.cjs --corpus --sweep      score every candidate, enforce no-regress
//   node replay.cjs --candidate <file>    score a forked claim-patterns against current

const fs = require('node:fs');
const path = require('node:path');
const ledger = require('./ledger.cjs');
const corpus = require('./corpus.cjs');
const labels = require('./labels.cjs');
const { CONFIG } = require('./claim-patterns.cjs');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

// `arg` returns true for a flag given without a value, and Number(true) is 1, so
// a bare --corpus or --pin silently replayed one transcript instead of the default.
const num = (name, dflt) => {
  const v = arg(name, null);
  const n = typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

// The replay objective, eq. 1 retargeted. Quality is a confirmed catch, cost is
// a proven false positive plus a flat charge per blocked turn standing in for
// the paper's execution-cost term. What a flag costs when nothing can settle it
// either way is nothing: charging it was what made declining to look the winning
// move, since a class that is switched off cannot be wrong.
//
// Labelling lives in labels.cjs and does not change when the policy does.
const B1 = 1;
const B2 = 0.25;

function score(worlds, classify, cfg) {
  const flags = worlds.map((w) => classify(w.answer, w.ev, cfg).unbacked);

  // One pass per transcript to find which flagged literals the session had
  // already printed. Zero re-execution: it is the same record, read once more.
  const byFile = new Map();
  worlds.forEach((w, i) => {
    if (!flags[i].length || !w.file) return;
    if (!byFile.has(w.file)) byFile.set(w.file, []);
    byFile.get(w.file).push(i);
  });
  const seen = new Map();
  for (const [file, idxs] of byFile) {
    const wanted = new Set();
    for (const i of idxs) for (const f of flags[i]) wanted.add(f.span.replace(/:\d+$/, ''));
    const found = corpus.outputIndex(file, worlds[idxs[0]].bytes, wanted);
    for (const i of idxs) seen.set(i, found);
  }

  let caught = 0, fp = 0, unknown = 0, blocked = 0, clean = 0;
  const byClass = {};
  worlds.forEach((w, i) => {
    if (!flags[i].length) { clean += 1; return; }
    blocked += 1;
    const found = seen.get(i) || new Map();
    for (const f of flags[i]) {
      // A block the gate actually issued has a recorded outcome, which is the
      // one label here that is not inferred, so it wins outright.
      const t = w.truth && w.truth[f.span];
      const v = typeof t === 'boolean'
        ? (t ? { c: 1, e: 0, u: 0 } : { c: 0, e: 1, u: 0 })
        : labels.label(f, w, found.get(f.span.replace(/:\d+$/, '')), found.testPassSeqs);
      caught += v.c; fp += v.e; unknown += v.u;
      byClass[f.class] = byClass[f.class] || { caught: 0, fp: 0, unknown: 0 };
      byClass[f.class].caught += v.c; byClass[f.class].fp += v.e; byClass[f.class].unknown += v.u;
    }
  });
  return { V: caught - B1 * fp - B2 * blocked, caught, fp, unknown, blocked, clean, byClass };
}

// Block rate is printed next to V because V alone does not see it: a policy that
// flags half the session can still score well, and would be muted within a day.
const fmt = (s) =>
  `V=${s.V.toFixed(1).padStart(8)}  caught=${s.caught.toFixed(0).padStart(4)}  fp=${s.fp.toFixed(0).padStart(4)}  unknown=${String(s.unknown).padStart(5)}  blocks=${String(s.blocked).padStart(4)}/${s.blocked + s.clean} (${(100 * s.blocked / Math.max(1, s.blocked + s.clean)).toFixed(1)}%)`;

// Candidates: one knob moved at a time off the current config, plus the current
// config itself. Keeping pi^0 in the set is what makes the guarantee hold.
function candidates() {
  const out = [{ name: 'current (pi^0)', cfg: {} }];
  for (const k of Object.keys(CONFIG)) {
    out.push({ name: `${k}=${!CONFIG[k]}`, cfg: { [k]: !CONFIG[k] } });
  }
  // A couple of pairs worth trying together.
  out.push({ name: 'version=false + url=false', cfg: { version: false, url: false } });
  out.push({ name: 'absence strict + basename off', cfg: { absenceAfterWrite: true, pathBasenameFallback: false } });
  out.push({ name: 'slash-only paths + absence off', cfg: { pathRequiresSlash: true, absence: false } });
  // Two reference points. Nothing-at-all is the floor any gate has to clear to
  // be worth running; everything-at-once is the check that the objective is not
  // simply paying for volume.
  out.push({ name: 'existence only (path=false, pathMissing on)', cfg: { path: false, pathMissing: true } });
  out.push({ name: 'NOTHING (no gate at all)', cfg: { path: false, outcome: false, absence: false, version: false, url: false, pathMissing: false } });
  out.push({ name: 'NOISE (every class, no filters)', cfg: { version: true, absence: true, pathRequiresSlash: false } });
  return out;
}

function main() {
  if (process.argv.includes('--pin')) {
    const n = num('--pin', 596);
    const { added, total } = corpus.pin(n);
    console.log(`pinned +${added} world${added === 1 ? '' : 's'}, ${total} total -> ${corpus.lockPath()}`);
    console.log('The history is now fixed. Re-pin to admit new sessions; nothing is ever dropped.');
    return;
  }

  const useCorpus = process.argv.includes('--corpus');
  const { classify } = require('./claim-patterns.cjs');

  let worlds;
  if (useCorpus) {
    const n = num('--corpus', 120);
    const lock = corpus.readLock();
    worlds = corpus.build(n);
    console.log(lock
      ? `replayed ${worlds.length} turns from ${lock.worlds.length} pinned worlds, zero re-execution\n`
      : `replayed ${worlds.length} turns from the ${n} most recent transcripts, zero re-execution\n` +
        'WARNING: the history is not pinned, so a winner here can lose on the next draw. Run --pin first.\n');
  } else {
    // `final` used to be a copy of `ev`, which made resolvedLater structurally
    // false in this mode: every "did the evidence show up later" test compared
    // the manifest against itself. The session's end-state manifest is the
    // record that answers it, and it is already on disk.
    worlds = ledger.read()
      .filter((n) => n.answer && n.evidence)
      .map((n) => {
        const ev = {
          paths: new Set(n.evidence.paths || []), commands: n.evidence.commands || [],
          searches: n.evidence.searches || [], urls: new Set(n.evidence.urls || []),
          libLookup: !!n.evidence.libLookup, seq: n.evidence.seq || 0, lastWrite: n.evidence.lastWrite || 0,
          testOut: n.evidence.testOut || 0,
          // classify reads cwd off the manifest, not off the world, because the
          // live hook only ever hands it a manifest.
          cwd: n.evidence.cwd || '',
        };
        const m = ledger.readManifest(n.session);
        const final = (m.paths.size || m.commands.length || m.searches.length || m.urls.size) ? m : ev;
        // resolved=true means none of the blocked spans came back, so the model
        // went and fixed the claim. resolved=false means it came back unchanged,
        // which is the gate having been wrong.
        const truth = {};
        if (n.action === 'block' && typeof n.resolved === 'boolean') {
          for (const c of n.claims || []) truth[c.span] = n.resolved;
        }
        return {
          answer: n.answer, ev, final, truth,
          nextUser: '', idx: 0, cwd: n.evidence.cwd || '', ageDays: 0,
          file: null, bytes: 0,
        };
      });
    if (worlds.length < 20) {
      console.log(`The ledger holds ${worlds.length} replayable nodes, too few to score a change.`);
      console.log('Use --corpus to replay over real transcripts instead.');
      process.exit(0);
    }
    console.log(`replayed ${worlds.length} ledger nodes, zero re-execution\n`);
  }

  const current = score(worlds, classify, {});
  console.log(`current    ${fmt(current)}`);
  for (const [k, v] of Object.entries(current.byClass).sort((a, b) => b[1].caught - a[1].caught)) {
    console.log(`             ${k.padEnd(16)} caught ${v.caught.toFixed(0).padStart(4)}  fp ${v.fp.toFixed(0).padStart(4)}  unknown ${String(v.unknown).padStart(5)}`);
  }

  const candidatePath = arg('--candidate');
  if (typeof candidatePath === 'string') {
    delete require.cache[require.resolve(path.resolve(candidatePath))];
    const alt = require(path.resolve(candidatePath)).classify;
    const cand = score(worlds, alt, {});
    console.log(`\ncandidate  ${fmt(cand)}`);
    console.log(cand.V >= current.V
      ? `\nSHIP. ${cand.V.toFixed(1)} >= ${current.V.toFixed(1)}, so the no-regress bound holds.`
      : `\nREJECT. ${cand.V.toFixed(1)} < ${current.V.toFixed(1)}. The current config stays.`);
    if (cand.V < current.V) process.exitCode = 1;
    return;
  }

  if (!process.argv.includes('--sweep')) return;

  console.log('\n--- dreaming over candidate policies ---');
  const scored = candidates().map((c) => ({ ...c, s: score(worlds, classify, c.cfg) }));
  scored.sort((a, b) => b.s.V - a.s.V);
  for (const c of scored) console.log(`${c.name.padEnd(34)} ${fmt(c.s)}`);

  const best = scored[0];
  const base = scored.find((c) => c.name.startsWith('current'));
  console.log();
  if (best.name === base.name) {
    console.log(`No candidate beat the current config (V=${base.s.V.toFixed(1)}). Nothing ships.`);
  } else {
    console.log(`BEST: ${best.name}  V=${best.s.V.toFixed(1)} vs current ${base.s.V.toFixed(1)}  (+${(best.s.V - base.s.V).toFixed(1)})`);
    console.log('Apply by editing CONFIG in claim-patterns.cjs, then re-run to confirm.');
  }
}

main();
