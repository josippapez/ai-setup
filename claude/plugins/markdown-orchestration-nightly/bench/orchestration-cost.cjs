#!/usr/bin/env node
// Reports tokens, estimated cost, wall-clock, and turns for every orchestration subagent found in
// Claude Code transcripts, grouped by plugin namespace and role, so a stable epic and a nightly
// epic can be compared. Read-only. Usage:
//   node orchestration-cost.cjs [--since YYYY-MM-DD] [--project <substring>] [--json]
const fs = require('node:fs');
const path = require('node:path');

// First-party API $/MTok (input, output). Cache read = 10% of input except fable ($0.25 flat);
// cache write = 1.25x input. Source: claude-api skill model table, cached 2026-06-24.
const PRICE = {
  'claude-haiku-4-5': [1, 5],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-4-6': [3, 15],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-fable-5-1': [10, 50],
  'claude-fable-5': [10, 50],
};

function cost(model, u) {
  const hit = Object.entries(PRICE).find(([k]) => model && model.startsWith(k));
  if (!hit) return null;
  const [i, o] = hit[1];
  const cr = model.startsWith('claude-fable') ? 0.25 : i * 0.1;
  return (u.in * i + u.out * o + u.cr * cr + u.cw * i * 1.25) / 1e6;
}

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* partial line */ }
  }
  return out;
}

// Link every Agent tool_use to the agentId in its tool_result. Returns {agentId: meta}.
function collectDispatches(records, parentAgent, project, file) {
  const pending = {};
  const found = {};
  for (const o of records) {
    for (const b of o.message?.content || []) {
      if (b.type === 'tool_use' && b.name === 'Agent') {
        pending[b.id] = { type: b.input?.subagent_type || '?', model: b.input?.model || 'frontmatter', promptLen: (b.input?.prompt || '').length };
      }
      if (b.type === 'tool_result' && pending[b.tool_use_id]) {
        const id = o.toolUseResult?.agentId;
        if (id) found[id] = { ...pending[b.tool_use_id], parent: parentAgent, project, file, ts: o.timestamp };
      }
    }
  }
  return found;
}

// Sum usage across one subagent transcript.
function usageOf(records) {
  const u = { in: 0, out: 0, cr: 0, cw: 0, turns: 0, tools: 0, model: null, t0: null, t1: null };
  for (const o of records) {
    if (o.timestamp) { u.t0 = u.t0 || o.timestamp; u.t1 = o.timestamp; }
    const m = o.message;
    if (o.type === 'assistant' && m?.usage) {
      u.turns++;
      u.model = u.model || m.model;
      u.in += m.usage.input_tokens || 0;
      u.out += m.usage.output_tokens || 0;
      u.cr += m.usage.cache_read_input_tokens || 0;
      u.cw += m.usage.cache_creation_input_tokens || 0;
      for (const b of m.content || []) if (b.type === 'tool_use') u.tools++;
    }
  }
  u.minutes = u.t0 && u.t1 ? (new Date(u.t1) - new Date(u.t0)) / 60000 : 0;
  u.totalTokens = u.in + u.out + u.cr + u.cw;
  return u;
}

function scanProjects(root, { since, project } = {}) {
  const agents = {};
  const usage = {};
  for (const proj of fs.readdirSync(root)) {
    if (project && !proj.includes(project)) continue;
    const dir = path.join(root, proj);
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const f of entries.filter((e) => e.endsWith('.jsonl'))) {
      Object.assign(agents, collectDispatches(parseLines(safeRead(path.join(dir, f))), null, proj, f));
    }
    for (const session of entries.filter((e) => !e.endsWith('.jsonl'))) {
      const sub = path.join(dir, session, 'subagents');
      if (!fs.existsSync(sub)) continue;
      for (const af of fs.readdirSync(sub).filter((e) => e.endsWith('.jsonl'))) {
        const id = af.replace(/^agent-|\.jsonl$/g, '');
        const records = parseLines(safeRead(path.join(sub, af)));
        Object.assign(agents, collectDispatches(records, id, proj, session));
        usage[id] = usageOf(records);
      }
    }
  }
  const rows = [];
  for (const [id, a] of Object.entries(agents)) {
    const m = /^(markdown-orchestration(?:-nightly)?):(.+)$/.exec(a.type);
    if (!m) continue;
    const u = usage[id];
    if (!u || !u.turns) continue;
    if (since && a.ts && a.ts < since) continue;
    rows.push({ id, plugin: m[1], role: m[2], ...a, ...u, cost: cost(u.model, u) });
  }
  return rows;
}

function aggregate(rows) {
  const agg = {};
  for (const r of rows) {
    const k = `${r.plugin} | ${r.role} | ${r.model}`;
    const a = (agg[k] ||= { plugin: r.plugin, role: r.role, model: r.model, n: 0, tokens: 0, cost: 0, minutes: 0, turns: 0 });
    a.n++; a.tokens += r.totalTokens; a.cost += r.cost || 0; a.minutes += r.minutes; a.turns += r.turns;
  }
  return Object.values(agg).sort((x, y) => x.plugin.localeCompare(y.plugin) || x.role.localeCompare(y.role) || x.model.localeCompare(y.model));
}

function perPlugin(rows) {
  const out = {};
  for (const r of rows) {
    const p = (out[r.plugin] ||= { agents: 0, tokens: 0, cost: 0, minutes: 0 });
    p.agents++; p.tokens += r.totalTokens; p.cost += r.cost || 0; p.minutes += r.minutes;
  }
  return out;
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--since') args.since = argv[++i];
    else if (argv[i] === '--project') args.project = argv[++i];
  }
  const root = process.env.CLAUDE_PROJECTS_DIR || path.join(process.env.HOME, '.claude/projects');
  const rows = scanProjects(root, args);
  const agg = aggregate(rows);
  const totals = perPlugin(rows);
  if (args.json) { process.stdout.write(JSON.stringify({ rows, agg, totals }, null, 1)); return; }
  console.log('plugin | role | model'.padEnd(70), 'n', 'avgTokens(k)', 'avg$', 'avgMin', 'avgTurns');
  for (const a of agg) {
    console.log(`${a.plugin} | ${a.role} | ${a.model}`.padEnd(70), a.n, Math.round(a.tokens / a.n / 1000), (a.cost / a.n).toFixed(2), (a.minutes / a.n).toFixed(1), Math.round(a.turns / a.n));
  }
  console.log('\nper plugin (sum over all dispatched agents in scope):');
  for (const [p, t] of Object.entries(totals)) {
    console.log(`${p.padEnd(32)} agents=${t.agents} tokens=${Math.round(t.tokens / 1000)}k $${t.cost.toFixed(2)} agent-minutes=${t.minutes.toFixed(0)}`);
  }
}

module.exports = { cost, usageOf, collectDispatches, scanProjects, aggregate, perPlugin, PRICE };
if (require.main === module) main(process.argv.slice(2));
