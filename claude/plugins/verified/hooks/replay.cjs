#!/usr/bin/env node
'use strict';
// Stage 5: score a proposed change to claim-patterns.cjs against the stored
// ledger, without re-running a single tool call.
//
// This is Dream-RSI's dreaming step (§3, p.5-6). Every ledger node holds the
// answer text and the evidence manifest as they were, so an alternative
// configuration can be replayed over the whole history and scored by reading
// stored records. The paper's guarantee is that the current config stays in the
// candidate set, so the version that ships can never score worse (V^{m*} >= V^0,
// p.6). That is enforced here: a change that scores below the current one is
// rejected, not merged.
//
// Usage:
//   node replay.cjs                      score the current config over the ledger
//   node replay.cjs --candidate <file>   score <file> against the current config
//
// The candidate file is a drop-in replacement for claim-patterns.cjs.

const path = require('node:path');
const ledger = require('./ledger.cjs');

// Weights on the replay objective, eq. 1 retargeted. Config, so a change to them
// is itself subject to this same check.
const B1 = 1;    // penalty per false positive
const B2 = 0.25; // penalty per extra round spent blocked, the execution-cost term

function score(nodes, classify) {
  let catches = 0, falsePositives = 0, blocked = 0, passes = 0;
  for (const n of nodes) {
    if (!n.answer || !n.evidence) continue;
    const ev = {
      paths: new Set(n.evidence.paths || []),
      commands: n.evidence.commands || [],
      searches: n.evidence.searches || [],
      urls: new Set(n.evidence.urls || []),
      libLookup: !!n.evidence.libLookup,
    };
    const { unbacked } = classify(n.answer, ev);
    if (unbacked.length === 0) { passes += 1; continue; }
    blocked += 1;
    // `resolved` was written on the following Stop: did the flagged span actually
    // change? A span that came back identical means the gate was wrong.
    if (n.resolved === true) catches += 1;
    else if (n.resolved === false) falsePositives += 1;
  }
  return { V: catches - B1 * falsePositives - B2 * blocked, catches, falsePositives, blocked, passes };
}

function load(file) {
  delete require.cache[require.resolve(file)];
  return require(file).classify;
}

const fmt = (s) =>
  `V=${s.V.toFixed(2)}  catches=${s.catches}  false-positives=${s.falsePositives}  blocked=${s.blocked}  passed=${s.passes}`;

function main() {
  const nodes = ledger.read().filter((n) => n.answer && n.evidence);
  if (nodes.length === 0) {
    console.log('Ledger has no replayable nodes yet. The gate has to run for a while first.');
    process.exit(0);
  }

  const current = score(nodes, load(path.join(__dirname, 'claim-patterns.cjs')));
  console.log(`replayed ${nodes.length} stored turns, zero re-execution\n`);
  console.log(`current    ${fmt(current)}`);

  const i = process.argv.indexOf('--candidate');
  if (i === -1) return;

  const candidatePath = path.resolve(process.argv[i + 1] || '');
  const candidate = score(nodes, load(candidatePath));
  console.log(`candidate  ${fmt(candidate)}\n`);

  if (candidate.V >= current.V) {
    console.log(`SHIP. ${candidate.V.toFixed(2)} >= ${current.V.toFixed(2)}, so the no-regress bound holds.`);
  } else {
    console.log(`REJECT. ${candidate.V.toFixed(2)} < ${current.V.toFixed(2)}. The current config stays.`);
    process.exitCode = 1;
  }
}

main();
