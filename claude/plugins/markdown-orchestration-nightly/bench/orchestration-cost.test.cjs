const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { cost, usageOf, collectDispatches, scanProjects, aggregate } = require('./orchestration-cost.cjs');

const usage = (input_tokens, output_tokens, cache_read_input_tokens = 0, cache_creation_input_tokens = 0) => ({ input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens });

test('cost prices cache reads at 10% of input and cache writes at 125%', () => {
  const u = { in: 1e6, out: 0, cr: 1e6, cw: 1e6 };
  assert.equal(cost('claude-sonnet-5', u), 2 + 0.2 + 2.5);
  assert.equal(cost('claude-opus-5', { in: 0, out: 1e6, cr: 0, cw: 0 }), 25);
  assert.equal(cost('claude-fable-5-1', { in: 0, out: 0, cr: 1e6, cw: 0 }), 0.25);
  assert.equal(cost('claude-unknown', u), null);
});

test('usageOf sums assistant usage, counts turns and tool calls, measures minutes', () => {
  const records = [
    { type: 'user', timestamp: '2026-09-01T10:00:00Z', message: { role: 'user', content: 'go' } },
    { type: 'assistant', timestamp: '2026-09-01T10:01:00Z', message: { model: 'claude-sonnet-5', usage: usage(100, 10, 1000, 50), content: [{ type: 'tool_use', name: 'Read', id: 't1' }] } },
    { type: 'assistant', timestamp: '2026-09-01T10:03:00Z', message: { model: 'claude-sonnet-5', usage: usage(200, 20), content: [{ type: 'text', text: 'done' }] } },
  ];
  const u = usageOf(records);
  assert.deepEqual([u.in, u.out, u.cr, u.cw, u.turns, u.tools, u.minutes, u.totalTokens], [300, 30, 1000, 50, 2, 1, 3, 1380]);
  assert.equal(u.model, 'claude-sonnet-5');
});

test('collectDispatches links an Agent tool_use to the agentId in its result', () => {
  const records = [
    { message: { content: [{ type: 'tool_use', name: 'Agent', id: 'tu1', input: { subagent_type: 'markdown-orchestration-nightly:md-builder', model: 'haiku', prompt: 'x' } }] } },
    { timestamp: '2026-09-01T00:00:00Z', toolUseResult: { agentId: 'abc' }, message: { content: [{ type: 'tool_result', tool_use_id: 'tu1' }] } },
  ];
  const found = collectDispatches(records, null, 'proj', 'main.jsonl');
  assert.deepEqual(found.abc, { type: 'markdown-orchestration-nightly:md-builder', model: 'haiku', promptLen: 1, parent: null, project: 'proj', file: 'main.jsonl', ts: '2026-09-01T00:00:00Z' });
});

test('scanProjects walks main + subagent transcripts and aggregates by plugin namespace', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cost-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proj = path.join(root, '-Users-me-repo');
  fs.mkdirSync(path.join(proj, 'sess1', 'subagents'), { recursive: true });
  const line = (o) => `${JSON.stringify(o)}\n`;
  fs.writeFileSync(path.join(proj, 'sess1.jsonl'),
    line({ message: { content: [{ type: 'tool_use', name: 'Agent', id: 'a', input: { subagent_type: 'markdown-orchestration:md-worker', model: 'sonnet' } }, { type: 'tool_use', name: 'Agent', id: 'b', input: { subagent_type: 'markdown-orchestration-nightly:md-builder', model: 'sonnet' } }, { type: 'tool_use', name: 'Agent', id: 'c', input: { subagent_type: 'Explore' } }] } })
    + line({ timestamp: '2026-09-01T00:00:00Z', toolUseResult: { agentId: 'w1' }, message: { content: [{ type: 'tool_result', tool_use_id: 'a' }] } })
    + line({ timestamp: '2026-09-01T00:00:00Z', toolUseResult: { agentId: 'n1' }, message: { content: [{ type: 'tool_result', tool_use_id: 'b' }] } })
    + line({ timestamp: '2026-09-01T00:00:00Z', toolUseResult: { agentId: 'x1' }, message: { content: [{ type: 'tool_result', tool_use_id: 'c' }] } }));
  const turn = (model, i, o) => line({ type: 'assistant', timestamp: '2026-09-01T00:00:00Z', message: { model, usage: usage(i, o), content: [] } });
  fs.writeFileSync(path.join(proj, 'sess1/subagents/agent-w1.jsonl'), turn('claude-sonnet-5', 1000, 100) + turn('claude-sonnet-5', 1000, 100));
  fs.writeFileSync(path.join(proj, 'sess1/subagents/agent-n1.jsonl'), turn('claude-sonnet-5', 500, 50));
  fs.writeFileSync(path.join(proj, 'sess1/subagents/agent-x1.jsonl'), turn('claude-sonnet-5', 9999, 9999));
  // a broken symlink must not abort the scan
  fs.symlinkSync(path.join(root, 'missing.jsonl'), path.join(proj, 'sess1/subagents/agent-gone.jsonl'));

  const rows = scanProjects(root);
  assert.deepEqual(rows.map((r) => `${r.plugin}:${r.role}:${r.totalTokens}`).sort(), ['markdown-orchestration-nightly:md-builder:550', 'markdown-orchestration:md-worker:2200']);
  const agg = aggregate(rows);
  assert.equal(agg.length, 2);
  assert.equal(agg.find((a) => a.plugin === 'markdown-orchestration').turns, 2);
});
