const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const plugin = path.resolve(__dirname, '..');
const repo = path.resolve(plugin, '../../..');
const agents = path.join(plugin, 'agents');
const skill = path.join(plugin, 'skills/orchestrate-nightly');

const requiredAgents = [
  'repo-scout', 'solution-reuse-scout', 'impl-planner', 'council-member', 'design-lead',
  'docs-maintainer', 'test-specialist', 'wcag-reviewer', 'md-builder', 'batch-reviewer', 'md-fixer',
];
const removedAgents = ['md-worker', 'md-reviewer', 'code-standards-checker', 'quality-gates-checker', 'regression-checker', 'implementation-quality-reviewer'];

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('every routed nightly specialist exists and the stable per-chunk gates do not', () => {
  for (const name of requiredAgents) assert.ok(fs.existsSync(path.join(agents, `${name}.md`)), name);
  for (const name of removedAgents) assert.ok(!fs.existsSync(path.join(agents, `${name}.md`)), `${name} should not exist in nightly`);
});

test('agent markdown has closed frontmatter with name matching the file', () => {
  for (const entry of fs.readdirSync(agents).filter((f) => f.endsWith('.md'))) {
    const text = read(agents, entry);
    const m = /^---\n([\s\S]+?)\n---\n/.exec(text);
    assert.ok(m, entry);
    assert.match(m[1], new RegExp(`^name: ${entry.replace(/\.md$/, '')}$`, 'm'), entry);
  }
});

test('routing names only agents that exist, under the nightly namespace', () => {
  const routing = read(skill, 'references/routing.md');
  const named = [...routing.matchAll(/`orchestrate-nightly:([a-z-]+)`/g)].map((m) => m[1]);
  assert.ok(named.length >= 10, 'routing should name the nightly agents');
  for (const n of new Set(named)) assert.ok(fs.existsSync(path.join(agents, `${n}.md`)), `routing names missing agent ${n}`);
  for (const gone of removedAgents) assert.doesNotMatch(routing, new RegExp(`orchestrate-nightly:${gone}\``), gone);
  // companion skills stay on the stable plugin
  for (const s of ['orchestrate:grilling', 'orchestrate:grill-with-docs', 'orchestrate:domain-modeling']) assert.ok(routing.includes(s), s);
});

test('no nightly agent spawns agents; the builder runs commands itself', () => {
  for (const name of ['md-builder', 'batch-reviewer', 'md-fixer']) {
    const text = read(agents, `${name}.md`);
    assert.ok(!/subagent_type/.test(text), `${name} must not dispatch agents`);
    assert.ok(text.includes('Never move status') || text.includes('never move status') || text.includes('never moves status'), `${name}: status ownership`);
  }
  const builder = read(agents, 'md-builder.md');
  for (const token of ['non_test_quality_commands', 'test_surface', 'Never spawn agents', 'verbatim']) assert.ok(builder.includes(token), token);
  const reviewer = read(agents, 'batch-reviewer.md');
  for (const token of ['applicable_documented_standards', 'Root cause', 'Implementation quality', 're-run', 'mechanical']) assert.ok(reviewer.includes(token), token);
});

test('platform reference carries the nightly model policy and no nested dispatch', () => {
  const platform = read(skill, 'references/platform.md');
  assert.ok(platform.includes('| `high` | sonnet |'), 'high without risk builds on sonnet');
  assert.ok(platform.includes('| `high` + risk tag | opus |'), 'risk-tagged high builds on opus');
  assert.ok(platform.includes('## No nested dispatch'));
  assert.ok(platform.includes('Never review on haiku'));
});

test('routing defines batch formation and where the removed gates went', () => {
  const routing = read(skill, 'references/routing.md');
  for (const token of ['## Review batches', 'Two untagged chunks are `In Review`', 'risk-tagged chunk reaches `In Review`: review it alone', '## Removed rows', '`quality-gates-checker` →', '`regression-checker` →']) {
    assert.ok(routing.includes(token), token);
  }
});

test('store protocol makes the orchestrator the only status writer', () => {
  const store = read(skill, 'references/store-protocol.md');
  assert.ok(store.includes('orchestrator is the only status writer'));
  assert.ok(!store.includes('The worker is the sole issue-status writer'));
});

test('issue template carries risk tags and the nightly comment shapes', () => {
  const issue = read(skill, 'templates/issue.md');
  for (const token of ['risk: []', '· md-builder — findings', '· batch-reviewer — PASS|FAIL', '· md-fixer — follow-up']) assert.ok(issue.includes(token), token);
  for (const gone of ['· md-reviewer', '· quality-gates-checker', '· regression-checker', '· code-standards-checker']) assert.ok(!issue.includes(gone), gone);
});

test('dispatcher loads references from an absolute skillRoot and stays under 2000 words', () => {
  const text = read(skill, 'SKILL.md');
  const words = text.trim().split(/\s+/).length;
  assert.ok(words < 2000, `${words} words`);
  assert.ok(text.includes('skillRoot = "${CLAUDE_SKILL_DIR}"'));
  assert.ok(text.includes('Before any agent or specialist dispatch'));
  const named = [...text.matchAll(/\$\{skillRoot\}\/((?:references|templates)\/[A-Za-z0-9.-]+\.md)/g)].map((m) => m[1]);
  assert.ok(named.length >= 8);
  for (const rel of new Set(named)) assert.ok(fs.existsSync(path.join(skill, rel)), rel);
  assert.doesNotMatch(text, /(?:Read|read|re-read)\s+`references\//);
  // explicit-only trigger: never the stable skill's generic phrases
  assert.ok(text.includes('Only on explicit request'));
  assert.ok(text.includes('workflow: nightly'));
});

test('plugin is registered in the marketplace, installer, and settings, and bundles no MCP server', () => {
  const marketplace = JSON.parse(read(repo, '.claude-plugin/marketplace.json'));
  assert.equal(marketplace.plugins.find((p) => p.name === 'orchestrate-nightly')?.source, './claude/plugins/orchestrate-nightly');
  const manifest = JSON.parse(read(plugin, '.claude-plugin/plugin.json'));
  assert.equal(manifest.name, 'orchestrate-nightly');
  assert.equal(manifest.mcpServers, undefined, 'nightly must reuse the stable plugin repo-docs MCP, not register a second one');
  assert.ok(!fs.existsSync(path.join(plugin, '.mcp.json')));
  const installer = read(repo, 'claude/install.sh');
  assert.ok(installer.includes('orchestrate-nightly@ai-setup'));
  const settings = JSON.parse(read(repo, 'claude/settings.json'));
  assert.equal(settings.enabledPlugins['orchestrate-nightly@ai-setup'], true);
});
