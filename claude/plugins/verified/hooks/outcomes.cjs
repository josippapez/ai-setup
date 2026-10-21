#!/usr/bin/env node
'use strict';
// What happened after each block, sorted the way a code reviewer's comments get sorted by the
// author's response. `resolved` cannot say it: the model always rewrites, so every live block of
// Oct 2026 read as resolved while a hand audit found about 8 of 49 right.
//
//   node outcomes.cjs [--since YYYY-MM-DD] [--list]
//
//   checked       the rewrite ran the test or fetched the page the block asked for
//   kept          the rewrite still makes the claim with nothing new behind it
//   dropped       the rewrite left the claim out without checking it
//   side-summary  the block hit a compaction or away summary, which has no manifest to check against
//   no-rewrite    the session never answered on that thread again
//
// --list prints each block from train sessions only, so the held-out side stays unread.

const ledger = require('./ledger.cjs');
const labels = require('./labels.cjs');
const split = require('./split.cjs');
const { rewritePairs } = require('./replay.cjs');

const OUTCOMES = ['checked', 'kept', 'dropped', 'side-summary', 'no-rewrite'];

function outcomeOf(claim, node, next) {
  const ev = node.evidence || {};
  if (!(ev.seq > 0)) return 'side-summary';
  if (!next) return 'no-rewrite';
  if (claim.class === 'command-outcome' || claim.class === 'url') {
    const world = { ev: { seq: ev.seq, urls: new Set(ev.urls || []) }, nextEv: next.evidence, nextAnswer: next.answer };
    if (labels.truthLabel(claim, world, true).c) return 'checked';
  }
  return next.answer.toLowerCase().includes(claim.span.toLowerCase()) ? 'kept' : 'dropped';
}

function sortBlocks(since) {
  const blocks = [];
  const next = new Map();
  const feed = rewritePairs((n, rewrite) => next.set(n, rewrite), (n) => n.action === 'block' && n.ts >= since);
  ledger.each((n) => {
    if (n.op || typeof n.answer !== 'string') return;
    if (n.action === 'block' && n.ts >= since) blocks.push(n);
    feed(n);
  });
  const rows = [];
  for (const n of blocks) {
    for (const c of n.claims || []) rows.push({ node: n, claim: c, outcome: outcomeOf(c, n, next.get(n)), rewrite: next.get(n) });
  }
  return rows;
}

function report(rows, since) {
  const classes = [...new Set(rows.map((r) => r.claim.class))].sort();
  console.log(`${rows.length} blocked claims since ${since}\n`);
  console.log(''.padEnd(16) + OUTCOMES.map((o) => o.padStart(14)).join(''));
  for (const cls of [...classes, 'all']) {
    const xs = cls === 'all' ? rows : rows.filter((r) => r.claim.class === cls);
    console.log(cls.padEnd(16) + OUTCOMES.map((o) => String(xs.filter((r) => r.outcome === o).length).padStart(14)).join(''));
  }
  // Not precision: a model re-runs a test it had already run just to get past the gate.
  // How often the gate blocks a claim that was fine is what clean.cjs counts.
  const checked = rows.filter((r) => r.outcome === 'checked').length;
  console.log(`\nthe rewrite ran the check: ${checked} of ${rows.length}` + (rows.length ? ` (${(100 * checked / rows.length).toFixed(0)}%)` : ''));
}

function list(rows) {
  const flat = (s, n) => String(s || '').replace(/\s+/g, ' ').slice(0, n);
  for (const r of rows) {
    if (split.splitOf(r.node.session) !== 'train') continue;
    console.log(`\n${r.node.ts.slice(0, 16)}  ${r.claim.class}  ${r.outcome}  "${flat(r.claim.span, 80)}"`);
    console.log(`  rewrite: ${r.rewrite ? flat(r.rewrite.answer, 200) : '(none)'}`);
  }
}

if (require.main === module) {
  const i = process.argv.indexOf('--since');
  const since = i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const rows = sortBlocks(since);
  report(rows, since);
  if (process.argv.includes('--list')) list(rows);
}

module.exports = { outcomeOf, sortBlocks, OUTCOMES };
