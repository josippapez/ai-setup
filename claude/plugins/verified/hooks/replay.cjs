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
const { CONFIG, pathSeen } = require('./claim-patterns.cjs');

// The replay objective, eq. 1 retargeted. Quality is a flag confirmed by any of
// three signals: the evidence shows up later in the session, the user's next
// message is a correction, or a claimed absolute path does not exist on disk.
// Cost is every flag none of those confirm, plus a flat charge per blocked turn
// standing in for the paper's execution-cost term.
//
// The first version scored only the evidence-appears-later signal, and it wanted
// to delete the path class: a claim nobody ever went back and checked looks
// identical to noise under that proxy, which is precisely the failure the gate
// exists to catch. The other two signals are what make the path verdict mean
// something.
const B1 = 1;
const B2 = 0.25;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const num = (name, dflt) => {
  const v = arg(name, null);
  const n = typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

// The user pushing back is ground truth the transcript carries directly. When a
// flagged turn is followed by a correction, the flag was pointing at something
// real whether or not the evidence ever showed up.
const CORRECTION_RE =
  /\b(?:that'?s (?:not right|wrong|incorrect)|you'?re wrong|not (?:true|correct|right)|actually,? (?:no|it)|no,? (?:it|that|the)|wrong\b|incorrect\b|you (?:missed|forgot|did ?n'?t)|doesn'?t exist|there is no such|re-?check|check again|are you sure|did you (?:actually|even))/i;

// A path claim naming a file that is not on disk is wrong, full stop. No proxy
// needed. This is the label the evidence-appears-later signal cannot see, and
// its absence is what made the sweep want to delete the path class.
function pathIsFiction(span) {
  const p = span.replace(/:\d+$/, '');
  if (!p.includes('/')) return false;                 // bare filename, unresolvable
  if (!p.startsWith('/')) return false;               // relative to a cwd we do not know
  try { fs.statSync(p); return false; } catch { return true; }
}

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
    const corrected = CORRECTION_RE.test(String(w.nextUser || '').slice(0, 400));
    for (const f of unbacked) {
      // A block the gate actually issued has a recorded outcome: the next Stop
      // wrote whether the claim came back unchanged. That is the one label here
      // that is not a proxy, so it wins outright when it exists. Everything
      // below it is inference about a turn that was never blocked.
      const truth = w.truth && w.truth[f.span];
      const hit = typeof truth === 'boolean'
        ? truth
        : resolvedLater(f, w.ev, w.final)
          || corrected
          || (f.class === 'path' && pathIsFiction(f.span));
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
  out.push({ name: 'slash-only paths + absence off', cfg: { pathRequiresSlash: true, absence: false } });
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
        return { answer: n.answer, ev, final, truth };
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
