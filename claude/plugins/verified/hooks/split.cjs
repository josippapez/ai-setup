'use strict';
// Held-out split and noise estimate for replay.
//
// Replay is deterministic, so a config scores the same on every run. What still
// moves V is which sessions happen to be pinned, and rules written after reading
// flags in the pinned set are scored on the same set they were fitted to. So the
// sessions are split once: rules get designed from train flags only, and a change
// ships only when the held-out test sessions agree with train and the gain on
// them clears a bootstrap interval over sessions.

const crypto = require('node:crypto');
const path = require('node:path');

const TEST_SHARE = 0.3;
const RESAMPLES = 2000;

// The session id names a world in both sources: the transcript file in corpus
// mode, the node's session field in ledger mode. Hashing it instead of drawing at
// random keeps a session on the same side across runs, re-pins and modes.
function groupOf(w) {
  if (w.group) return w.group;
  return w.file ? path.basename(w.file, '.jsonl') : '';
}

function splitOf(group) {
  const h = crypto.createHash('sha1').update(String(group)).digest().readUInt32BE(0);
  return h / 0x100000000 < TEST_SHARE ? 'test' : 'train';
}

// mulberry32, seeded so the same inputs print the same interval.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-session totals of a per-world value array. */
function bySession(worlds, per) {
  const out = new Map();
  worlds.forEach((w, i) => {
    const g = groupOf(w);
    out.set(g, (out.get(g) || 0) + per[i]);
  });
  return out;
}

/** 95% percentile bootstrap interval of the sum, resampling sessions. */
function interval(values, seed = 1) {
  const n = values.length;
  if (!n) return [0, 0];
  const r = rng(seed);
  const sums = new Float64Array(RESAMPLES);
  for (let i = 0; i < RESAMPLES; i += 1) {
    let s = 0;
    for (let j = 0; j < n; j += 1) s += values[Math.floor(r() * n)];
    sums[i] = s;
  }
  sums.sort();
  return [sums[Math.floor(0.025 * RESAMPLES)], sums[Math.ceil(0.975 * RESAMPLES) - 1]];
}

function sides(sessions) {
  const out = { train: [], test: [] };
  for (const [g, v] of sessions) out[splitOf(g)].push(v);
  return out;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** V on each side of the split, with the interval on the test side. */
function summarize(worlds, per) {
  const s = sides(bySession(worlds, per));
  return {
    train: sum(s.train), test: sum(s.test),
    nTrain: s.train.length, nTest: s.test.length,
    ciTest: interval(s.test),
  };
}

/** Paired per-session difference between two configs scored on the same worlds. */
function compare(worlds, perBase, perCand) {
  const base = bySession(worlds, perBase);
  const cand = bySession(worlds, perCand);
  const d = new Map([...cand].map(([g, v]) => [g, v - (base.get(g) || 0)]));
  const s = sides(d);
  const moved = (xs) => xs.filter((x) => Math.abs(x) > 1e-9).length;
  return {
    train: sum(s.train), test: sum(s.test),
    movedTrain: moved(s.train), movedTest: moved(s.test),
    ciTest: interval(s.test),
  };
}

/**
 * The ship rule, in order. A regression on either side rejects. No session
 * moving is the old no-regress pass. A train gain the held-out sessions do not
 * share is the overfitting sign. A test gain whose interval reaches zero cannot
 * be told apart from which sessions happen to be pinned.
 */
function verdict(d) {
  const eps = 1e-9;
  if (d.train < -eps || d.test < -eps) return { ship: false, word: 'REJECT', why: 'a split scores worse' };
  if (!d.movedTrain && !d.movedTest) return { ship: true, word: 'SHIP', why: 'no session scores differently' };
  if (Math.abs(d.test) <= eps) {
    return {
      ship: false, word: 'OVERFIT',
      why: d.movedTest
        ? 'train gains while the held-out sessions stay flat'
        : 'no held-out session exercises the change, so the train gain is unconfirmed',
    };
  }
  if (d.ciTest[0] <= eps) return { ship: false, word: 'NOISE', why: 'the held-out gain is within the bootstrap interval of zero' };
  return { ship: true, word: 'SHIP', why: 'both splits gain and the held-out gain clears noise' };
}

module.exports = { groupOf, splitOf, rng, bySession, interval, summarize, compare, verdict, TEST_SHARE };
