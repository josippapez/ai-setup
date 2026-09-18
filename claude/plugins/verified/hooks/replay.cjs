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
//   node replay.cjs --corpus              score the current config
//   node replay.cjs --corpus --sweep      score every candidate, enforce no-regress
//   node replay.cjs --candidate <file>    score a forked claim-patterns against current

const path = require('node:path');
const ledger = require('./ledger.cjs');
const corpus = require('./corpus.cjs');
const { CONFIG, pathSeen } = require('./claim-patterns.cjs');

// The replay objective, eq. 1 retargeted. Quality is claims caught before they
// were checked; cost is every flag that never resolved, plus a flat charge per
// blocked turn standing in for the paper's execution-cost term.
const B1 = 1;
const B2 = 0.25;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

// Did the session go on to produce the evidence this flag asked for? If so the
// claim really was asserted ahead of its check, and the flag was a catch.
function resolvedLater(flag, ev, final) {
  switch (flag.class) {
    case 'path': {
      const p = flag.span.replace(/:\d+$/, '');
      return pathSeen(p, final.paths) && !pathSeen(p, ev.paths);
    }
    case 'command-outcome':
      return final.commands.some((c) => c.ok && (c.seq || 0) > ev.seq && /\b(test|lint|build|tsc|check)\b/.test(c.cmd));
    case 'absence':
      return final.searches.some((s) => (s.seq || 0) > ev.seq);
    case 'version':
      return final.libLookup && !ev.libLookup;
    case 'url': {
      let host = '';
      try { host = new URL(flag.span).host; } catch { return false; }
      return (final.urls.has(host) || final.urls.has('*')) && !ev.urls.has(host);
    }
    default:
      return false;
  }
}

function score(worlds, classify, cfg) {
  let caught = 0, unconfirmed = 0, blocked = 0, clean = 0;
  const byClass = {};
  for (const w of worlds) {
    const { unbacked } = classify(w.answer, w.ev, cfg);
    if (unbacked.length === 0) { clean += 1; continue; }
    blocked += 1;
    for (const f of unbacked) {
      const hit = resolvedLater(f, w.ev, w.final);
      byClass[f.class] = byClass[f.class] || { caught: 0, unconfirmed: 0 };
      if (hit) { caught += 1; byClass[f.class].caught += 1; }
      else { unconfirmed += 1; byClass[f.class].unconfirmed += 1; }
    }
  }
  return { V: caught - B1 * unconfirmed - B2 * blocked, caught, unconfirmed, blocked, clean, byClass };
}

const fmt = (s) =>
  `V=${s.V.toFixed(1).padStart(8)}  caught=${String(s.caught).padStart(4)}  unconfirmed=${String(s.unconfirmed).padStart(5)}  blocked=${String(s.blocked).padStart(4)}/${s.blocked + s.clean}`;

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
  return out;
}

function main() {
  const useCorpus = process.argv.includes('--corpus');
  const { classify } = require('./claim-patterns.cjs');

  let worlds;
  if (useCorpus) {
    const n = Number(arg('--corpus', 120)) || 120;
    worlds = corpus.build(n);
    console.log(`replayed ${worlds.length} turns from the ${n} most recent transcripts, zero re-execution\n`);
  } else {
    worlds = ledger.read()
      .filter((n) => n.answer && n.evidence)
      .map((n) => ({
        answer: n.answer,
        ev: {
          paths: new Set(n.evidence.paths || []), commands: n.evidence.commands || [],
          searches: n.evidence.searches || [], urls: new Set(n.evidence.urls || []),
          libLookup: !!n.evidence.libLookup, seq: n.evidence.seq || 0, lastWrite: n.evidence.lastWrite || 0,
        },
        final: {
          paths: new Set(n.evidence.paths || []), commands: n.evidence.commands || [],
          searches: n.evidence.searches || [], urls: new Set(n.evidence.urls || []),
          libLookup: !!n.evidence.libLookup, seq: n.evidence.seq || 0,
        },
      }));
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
    console.log(`             ${k.padEnd(16)} caught ${String(v.caught).padStart(4)}  unconfirmed ${String(v.unconfirmed).padStart(5)}`);
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
