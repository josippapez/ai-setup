#!/usr/bin/env node
'use strict';
// Hand-labelled check of the labeller. labels.cjs grades every block, and three
// shipped fixes needed an override because it graded wrong blocks as catches.
// This samples real live blocks from train sessions, keeps a person's verdict
// next to the labeller's, and reports how often they agree.
//
//   node gold.cjs --sample [N]     draw N blocked claims (default 50) into gold.json
//   node gold.cjs --page           write gold-review.html from gold.json
//   node gold.cjs --agreement [f]  labeller vs the hand labels in f (default gold.json)
//
// Both files sit in ~/.claude/verified/ because they carry answer text.

const fs = require('node:fs');
const path = require('node:path');
const ledger = require('./ledger.cjs');
const labels = require('./labels.cjs');
const split = require('./split.cjs');
const { ledgerWorlds } = require('./replay.cjs');

const GOLD = path.join(ledger.dir(), 'gold.json');
const PAGE = path.join(ledger.dir(), 'gold-review.html');
const QUOTA = { 'path-missing': 0.5, url: 0.3, 'command-outcome': 0.2 };
const WORD = (v) => (v.c ? 'catch' : v.e ? 'fp' : 'unknown');

const idOf = (session, ts, span) => `${session}|${ts}|${span}`;

// Every block the gate issued with a recorded outcome, with the labeller's verdict.
function blocks() {
  const out = [];
  for (const w of ledgerWorlds()) {
    for (const [span, resolved] of Object.entries(w.truth)) out.push({ w, span, resolved, cls: null });
  }
  return out;
}

function excerpt(text, needle, width = 280) {
  const t = String(text || '');
  const base = path.basename(String(needle).replace(/:\d+$/, ''));
  let i = t.indexOf(needle);
  if (i === -1) i = t.indexOf(base);
  if (i === -1) return t.slice(0, 2 * width);
  return (i > width ? '…' : '') + t.slice(Math.max(0, i - width), i + needle.length + width) + (i + needle.length + width < t.length ? '…' : '');
}

function verdictFor(b) {
  return WORD(labels.truthLabel({ class: b.cls, span: b.span }, b.w, b.resolved));
}

function sample(n) {
  const nodes = ledger.read();
  const classOf = new Map();
  for (const node of nodes) for (const c of node.claims || []) classOf.set(idOf(node.session, node.ts, c.span), c.class);

  const pool = {};
  for (const b of blocks()) {
    // Train only: rules get fitted to whatever gets read, so the held-out side stays unread.
    if (split.splitOf(b.w.group) !== 'train') continue;
    b.cls = classOf.get(idOf(b.w.group, b.w.ts, b.span));
    if (!QUOTA[b.cls]) continue;
    (pool[b.cls] = pool[b.cls] || []).push(b);
  }
  const r = split.rng(7);
  const cases = [];
  for (const [cls, share] of Object.entries(QUOTA)) {
    const xs = pool[cls] || [];
    const seen = new Set();
    for (let i = xs.length - 1; i > 0; i -= 1) { const j = Math.floor(r() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; }
    for (const b of xs) {
      if (cases.filter((c) => c.class === cls).length >= Math.round(n * share)) break;
      // One case per span per session, or a looping block fills the sample.
      const key = `${b.w.group}|${b.span}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cases.push({
        id: idOf(b.w.group, b.w.ts, b.span), class: cls, span: b.span, cwd: b.w.cwd,
        resolved: b.resolved, answer: excerpt(b.w.answer, b.span),
        rewrite: excerpt(b.w.nextAnswer, b.span), labeller: verdictFor(b), draft: null, gold: null, note: '',
      });
    }
  }
  fs.writeFileSync(GOLD, JSON.stringify(cases, null, 2));
  console.log(`sampled ${cases.length} train blocks -> ${GOLD}`);
}

function agreement(file) {
  const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
  const now = new Map();
  for (const b of blocks()) now.set(idOf(b.w.group, b.w.ts, b.span), b);
  const rows = [];
  for (const c of cases) {
    const human = c.gold || c.draft;
    if (!human) continue;
    const b = now.get(c.id);
    // Re-grade with today's labeller, so a labeller change shows up here.
    const lab = b ? verdictFor({ ...b, cls: c.class }) : c.labeller;
    rows.push({ cls: c.class, human, lab, from: c.gold ? 'gold' : 'draft' });
  }
  if (!rows.length) { console.log('No labelled cases yet.'); return; }
  const from = rows.filter((x) => x.from === 'gold').length;
  console.log(`${rows.length} labelled cases (${from} confirmed by a person, ${rows.length - from} draft only)\n`);
  const kinds = ['catch', 'fp', 'unknown'];
  for (const cls of [...new Set(rows.map((x) => x.cls)), 'all']) {
    const xs = cls === 'all' ? rows : rows.filter((x) => x.cls === cls);
    const agree = xs.filter((x) => x.human === x.lab).length;
    console.log(`${cls.padEnd(16)} agree ${agree}/${xs.length} (${(100 * agree / xs.length).toFixed(0)}%)`);
    if (cls !== 'all') continue;
    console.log('\nrows: person, columns: labeller');
    console.log(' '.repeat(10) + kinds.map((k) => k.padStart(9)).join(''));
    for (const h of kinds) console.log(h.padEnd(10) + kinds.map((l) => String(xs.filter((x) => x.human === h && x.lab === l).length).padStart(9)).join(''));
  }
}

function page() {
  const cases = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  const html = fs.readFileSync(path.join(__dirname, 'gold-review.html'), 'utf8')
    // A function, because case text holds `$` sequences a replacement string would expand.
    .replace('/*CASES*/[]', () => JSON.stringify(cases).replace(/</g, '\\u003c'));
  fs.writeFileSync(PAGE, html);
  console.log(`wrote ${PAGE}`);
}

if (process.argv.includes('--sample')) {
  const i = process.argv.indexOf('--sample');
  sample(Number(process.argv[i + 1]) > 0 ? Number(process.argv[i + 1]) : 50);
} else if (process.argv.includes('--page')) {
  page();
} else if (process.argv.includes('--agreement')) {
  const i = process.argv.indexOf('--agreement');
  const f = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : GOLD;
  agreement(f);
} else {
  console.log('usage: gold.cjs --sample [N] | --page | --agreement [file]');
}
