#!/usr/bin/env node
'use strict';
// The evaluator. Fixed on purpose: the paper's guarantee only holds while the
// policy is what changes and the thing scoring it does not (p.5), so this file
// is not tuned to make a favoured configuration win.
//
// The old scorer had two buckets, caught and unconfirmed, and charged every
// unconfirmed flag as a false positive. That is an assumption, not a
// measurement, and it is what made "turn the class off" the winning move:
// declining to look cost nothing. Three buckets instead:
//
//   catch    positive evidence the claim ran ahead of its check
//   fp       positive evidence the session HAD the check and the gate missed it
//   unknown  no evidence either way, charged nothing
//
// A flag is a proven false positive when the literal it names already appeared
// in this session's tool OUTPUT before the claim. The manifest records what
// tools were asked for, not what they printed, so that is exactly the blind spot.

const resolve = require('./resolve.cjs');

// Replaying old transcripts, a file can be missing now because it was never
// there or because the repo moved on. Control group: paths a Read or Edit
// provably opened, so they existed at the time. Those are missing now at 21.3%
// (414 sampled) for sessions under a week old and 31.2% (1892) for older ones,
// against 75.8% and 61.9% for paths that were claimed and never opened. That
// baseline share of every fiction flag is scored as a false positive.
//
// It is a replay artifact only. The live gate stats the file during the turn
// that names it, where the staleness rate is zero.
const STALE = { fresh: 0.213, old: 0.312 };

const CORRECTION_RE =
  /\b(?:that'?s (?:not right|wrong|incorrect)|you'?re wrong|not (?:true|correct|right)|actually,? (?:no|it)|no,? (?:it|that|the)|wrong\b|incorrect\b|you (?:missed|forgot|did ?n'?t)|doesn'?t exist|there is no such|re-?check|check again|are you sure|did you (?:actually|even))/i;

/** Did the session go on to produce the evidence this flag asked for? */
function resolvedLater(flag, ev, final) {
  switch (flag.class) {
    case 'path': {
      const p = flag.span.replace(/:\d+$/, '');
      const seen = (set) => { for (const s of set) if (s === p || s.endsWith('/' + p) || p.endsWith('/' + s)) return true; return false; };
      return seen(final.paths) && !seen(ev.paths);
    }
    case 'command-outcome':
      return final.commands.some((c) => c.ok && (c.seq || 0) > ev.seq && /\b(test|lint|build|tsc|check)\b/.test(c.cmd));
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

// What counts as the session having had the check in front of it, per class.
// The literal turning up somewhere in output is not enough on its own: "tests
// pass" appears in output when a judge payload or a GitHub comment quotes the
// claim, and a filename appears in every `git diff --stat`. Inspected on the
// flags this scored as proven wrong, and neither was a test run or a read.
function hadTheCheck(flag, seen, passSeqs, world) {
  const idx = world.idx;
  switch (flag.class) {
    case 'command-outcome': {
      // The policy's own question: a clean run at or after the last write and
      // before the claim. A pass line from before an edit does not back a claim
      // about the edited tree, and the policy is right to flag it.
      const ev = world.ev;
      return (passSeqs || []).some((s) => s <= (ev.seq || 0) && s >= (ev.lastWrite || 0));
    }
    case 'path':
      return !!seen && seen.turn < idx && seen.kind === 'content';
    default:
      return !!seen && seen.turn < idx;
  }
}

/**
 * One flag's verdict as fractional credit: { c, e, u } summing to 1.
 * `seen` is { turn, kind } for the first appearance of the flag's literal in
 * tool output, or undefined; `testPassAt` the first turn a runner summary line
 * appeared.
 */
function label(flag, world, seen, passSeqs) {
  const stale = world.ageDays <= 7 ? STALE.fresh : STALE.old;
  if (flag.class === 'path-missing' || (flag.class === 'path' && resolve.exists(flag.span, world.cwd) === 'missing')) {
    return { c: 1 - stale, e: stale, u: 0 };
  }
  if (CORRECTION_RE.test(String(world.nextUser || '').slice(0, 400))) return { c: 1, e: 0, u: 0 };
  if (hadTheCheck(flag, seen, passSeqs, world)) return { c: 0, e: 1, u: 0 };
  if (resolvedLater(flag, world.ev, world.final)) return { c: 1, e: 0, u: 0 };
  return { c: 0, e: 0, u: 1 };
}

module.exports = { label, resolvedLater, CORRECTION_RE, STALE };
