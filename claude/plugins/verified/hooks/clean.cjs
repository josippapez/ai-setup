#!/usr/bin/env node
'use strict';
// Claims a person confirmed were fine, kept with the manifest they were judged against, so
// every change can be checked for blocking them again. V cannot show this on its own: three
// shipped fixes needed an override because the labeller scored wrong blocks as catches.
//
//   node clean.cjs --add               copy the person-labelled false blocks from gold.json
//   node clean.cjs [--candidate <f>]   how many clean claims the current config, or <f>, blocks
//
// clean.json sits in ~/.claude/verified/ with gold.json, since both carry answer text.

const fs = require('node:fs');
const path = require('node:path');
const ledger = require('./ledger.cjs');
const corpus = require('./corpus.cjs');
const { evOf } = require('./replay.cjs');

const CLEAN = () => path.join(ledger.dir(), 'clean.json');
const GOLD = () => path.join(ledger.dir(), 'gold.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } };
// What a tool printing the flagged literal looks like to classify: a path by its file name.
const literal = (c) => (c.class === 'url' ? c.span : path.basename(c.span.replace(/:\d+$/, '')));

// gold.json is resampled from scratch by `gold.cjs --sample`, so the cases are copied out.
function add() {
  const have = new Set(readJson(CLEAN()).map((c) => c.id));
  // One answer can hold several labelled claims, so cases are grouped by the node they came from.
  const want = new Map();
  for (const c of readJson(GOLD())) {
    if (c.gold !== 'fp' || have.has(c.id)) continue;
    const key = c.id.split('|').slice(0, 2).join('|');
    want.set(key, (want.get(key) || []).concat(c));
  }
  const added = [];
  ledger.each((n) => {
    if (!want.has(`${n.session}|${n.ts}`) || !n.evidence || typeof n.answer !== 'string') return;
    for (const c of want.get(`${n.session}|${n.ts}`)) {
      const seen = corpus.seenInSession(n.session, new Set([literal(c)]));
      const printed = [...seen].filter(([, at]) => at < Date.parse(n.ts)).map(([w]) => w);
      added.push({ id: c.id, class: c.class, span: c.span, cwd: c.cwd, answer: n.answer, evidence: n.evidence, printed, note: c.note || '' });
    }
  });
  fs.writeFileSync(CLEAN(), JSON.stringify(readJson(CLEAN()).concat(added), null, 2));
  console.log(`added ${added.length} clean claims, ${have.size + added.length} in ${CLEAN()}`);
}

// The clean claims `classify` would block again. Notes do not count: they never stop a turn.
// Spans are matched by containment, so a candidate that trims the stored span's punctuation
// ("…/orders," in the Oct 2026 set) still counts as blocking it.
function cleanBlocks(classify) {
  // No file is an empty set. A file that does not parse throws, or the veto would switch off unseen.
  const cases = fs.existsSync(CLEAN()) ? JSON.parse(fs.readFileSync(CLEAN(), 'utf8')) : [];
  const same = (a, b) => a.includes(b) || b.includes(a);
  const blocked = cases.filter((c) => classify(c.answer, evOf(c.evidence, c.printed), {}).unbacked.some((f) => same(f.span, c.span)));
  return { total: cases.length, blocked };
}

if (require.main === module) {
  if (process.argv.includes('--add')) {
    add();
  } else {
    const i = process.argv.indexOf('--candidate');
    const file = i !== -1 ? path.resolve(process.argv[i + 1]) : './claim-patterns.cjs';
    const { total, blocked } = cleanBlocks(require(file).classify);
    console.log(`${blocked.length} of ${total} known-clean claims blocked`);
    for (const c of blocked) console.log(`  ${c.class}  ${c.span}${c.note ? `  (${c.note})` : ''}`);
  }
}

module.exports = { cleanBlocks };
