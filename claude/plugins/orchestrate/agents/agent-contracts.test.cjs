const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repo = path.resolve(__dirname, '../../../..');
const claudeAgents = path.join(repo, 'claude/plugins/orchestrate/agents');
const openCodeAgents = path.join(repo, 'opencode/agents');
const claudeSkill = path.join(repo, 'claude/plugins/orchestrate/skills/orchestrate');
const openCodeSkill = path.join(repo, 'opencode/skills/orchestrate');

const requiredAgents = [
  'repo-scout', 'solution-reuse-scout', 'md-worker', 'test-specialist',
  'code-standards-checker', 'quality-gates-checker', 'md-reviewer',
  'implementation-quality-reviewer', 'regression-checker', 'docs-maintainer',
  'wcag-reviewer', 'impl-planner', 'design-lead', 'council-member',
];

test('every routed specialist resolves on both platforms', () => {
  for (const name of requiredAgents) {
    assert.ok(fs.existsSync(path.join(claudeAgents, `${name}.md`)), `Claude: ${name}`);
    assert.ok(fs.existsSync(path.join(openCodeAgents, `${name}.md`)), `OpenCode: ${name}`);
  }
  for (const name of ['repo-scout-luna', 'council-member-luna', 'design-lead-sol', 'impl-planner-sol', 'md-worker-free', 'md-worker-terra', 'md-worker-luna', 'md-worker-sol', 'code-standards-checker-luna', 'code-standards-checker-sol', 'md-reviewer-sol', 'wcag-reviewer-sol']) {
    assert.ok(fs.existsSync(path.join(openCodeAgents, `${name}.md`)), `OpenCode variant: ${name}`);
  }
});

test('agent markdown has closed frontmatter', () => {
  for (const directory of [claudeAgents, openCodeAgents]) {
    for (const entry of fs.readdirSync(directory).filter((file) => file.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(directory, entry), 'utf8');
      assert.match(text, /^---\n[\s\S]+?\n---\n/, entry);
    }
  }
});

test('worker variants carry the conditional gate predicates and permissions', () => {
  for (const file of ['md-worker.md', 'md-worker-free.md', 'md-worker-terra.md', 'md-worker-luna.md', 'md-worker-sol.md']) {
    const text = fs.readFileSync(path.join(openCodeAgents, file), 'utf8');
    for (const token of ['applicable_documented_standards', 'quality-gates-checker: allow', 'implementation-quality-reviewer: allow', 'skipped']) {
      assert.ok(text.includes(token), `${file}: ${token}`);
    }
  }
});

test('standards checker stays narrow', () => {
  for (const file of ['code-standards-checker.md', 'code-standards-checker-luna.md', 'code-standards-checker-sol.md']) {
    const text = fs.readFileSync(path.join(openCodeAgents, file), 'utf8');
    assert.ok(text.includes('applicable_documented_standards'));
    assert.ok(text.includes('NEVER discover standards'));
    assert.ok(text.includes('run lint/format/typecheck/build/tests'));
  }
});

test('progressive references and canonical templates exist', () => {
  for (const directory of [claudeSkill, openCodeSkill]) {
    for (const file of ['routing.md', 'store-protocol.md', 'intake-design.md', 'execution.md', 'platform.md']) {
      assert.ok(fs.existsSync(path.join(directory, 'references', file)), `${directory}: ${file}`);
    }
    for (const file of ['PROJECT.md', 'EPIC.md', 'issue.md']) {
      assert.ok(fs.existsSync(path.join(directory, 'templates', file)), `${directory}: ${file}`);
    }
  }
});

test('compact skills deterministically load references and stay between 1200 and 1999 words', () => {
  for (const directory of [claudeSkill, openCodeSkill]) {
    const skill = fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8');
    const words = skill.trim().split(/\s+/).length;
    assert.ok(words >= 1200 && words < 2000, `${directory}: ${words} words`);
    for (const token of ['references/intake-design.md', 'references/store-protocol.md', 'references/execution.md', 'references/platform.md', 'references/routing.md', 'Before any agent or specialist dispatch']) {
      assert.ok(skill.includes(token), `${directory}: ${token}`);
    }
  }
});

test('dispatchers resolve bundled resources from an absolute skillRoot', () => {
  const claude = fs.readFileSync(path.join(claudeSkill, 'SKILL.md'), 'utf8');
  const openCode = fs.readFileSync(path.join(openCodeSkill, 'SKILL.md'), 'utf8');
  assert.ok(claude.includes('skillRoot = "${CLAUDE_SKILL_DIR}"'));
  assert.ok(claude.includes('Every Read call for a bundled resource MUST use an absolute `${skillRoot}/...` path'));
  assert.ok(openCode.includes('capture the absolute **Base directory**'));
  assert.ok(openCode.includes('search the configured OpenCode skill paths **once**'));
  assert.ok(openCode.includes('STOP with a clear resource-resolution error'));

  for (const [directory, skill] of [[claudeSkill, claude], [openCodeSkill, openCode]]) {
    const named = [...skill.matchAll(/\$\{skillRoot\}\/((?:references|templates)\/[A-Za-z0-9.-]+\.md)/g)]
      .map((match) => match[1]);
    assert.ok(named.length >= 8, `${directory}: expected all references/templates to be named`);
    for (const relative of new Set(named)) {
      assert.ok(fs.existsSync(path.join(directory, relative)), `${directory}: ${relative}`);
    }
    for (const forbidden of [/(?:Read|read|re-read)\s+`references\//, /(?:Read|read|re-read)\s+`templates\//]) {
      assert.doesNotMatch(skill, forbidden, `${directory}: cwd-relative directive`);
    }
  }
});

test('recursive install/package layouts preserve progressive resources', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrate-contract-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const stagedClaudePlugin = path.join(temp, 'claude-plugin');
  fs.cpSync(path.join(repo, 'claude/plugins/orchestrate'), stagedClaudePlugin, { recursive: true });
  const marketplace = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(marketplace.plugins.find((plugin) => plugin.name === 'orchestrate')?.source, './claude/plugins/orchestrate');

  const stagedOpenCode = path.join(temp, 'opencode');
  fs.mkdirSync(stagedOpenCode);
  execFileSync('cp', ['-R', path.join(repo, 'opencode/skills'), path.join(stagedOpenCode, 'skills')]);
  const openCodeInstaller = fs.readFileSync(path.join(repo, 'opencode/install.sh'), 'utf8');
  assert.ok(openCodeInstaller.includes('cp -R "$SRC/$directory" "$DEST/$directory"'));

  const installedRoots = [
    path.join(stagedClaudePlugin, 'skills/orchestrate'),
    path.join(stagedOpenCode, 'skills/orchestrate'),
  ];
  for (const directory of installedRoots) {
    for (const relative of [
      'SKILL.md',
      'references/routing.md', 'references/store-protocol.md',
      'references/intake-design.md', 'references/execution.md', 'references/platform.md',
      'templates/PROJECT.md', 'templates/EPIC.md', 'templates/issue.md',
    ]) {
      assert.ok(fs.existsSync(path.join(directory, relative)), `${directory}: ${relative}`);
    }
  }
});

test('routing matrix is the sole workflow predicate authority', () => {
  for (const directory of [claudeSkill, openCodeSkill]) {
    const skill = fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8');
    assert.ok(skill.includes('Routing predicates live only in `${skillRoot}/references/routing.md`'));
    const workflowFiles = [
      path.join(directory, 'SKILL.md'),
      ...fs.readdirSync(path.join(directory, 'references')).map((file) => path.join(directory, 'references', file)),
    ];
    const owners = workflowFiles.filter((file) => fs.readFileSync(file, 'utf8').includes('Exact predicate'));
    assert.deepEqual(owners, [path.join(directory, 'references', 'routing.md')]);
  }
});

test('Claude and OpenCode references are semantically aligned', () => {
  const commonFiles = ['store-protocol.md', 'intake-design.md', 'execution.md'];
  const headings = (text) => text.split('\n').filter((line) => /^#{1,3} /.test(line));
  for (const file of commonFiles) {
    const claude = fs.readFileSync(path.join(claudeSkill, 'references', file), 'utf8');
    const openCode = fs.readFileSync(path.join(openCodeSkill, 'references', file), 'utf8');
    assert.deepEqual(headings(claude), headings(openCode), file);
  }
  for (const token of [
    'applicable_documented_standards', 'owning_docs', 'non_test_quality_commands',
    'test_surface', 'solution_reuse_signals', 'solution-reuse-scout',
    'quality-gates-checker', 'implementation-quality-reviewer',
    'skipped: <reason>',
  ]) {
    for (const directory of [claudeSkill, openCodeSkill]) {
      const allReferences = fs.readdirSync(path.join(directory, 'references'))
        .map((file) => fs.readFileSync(path.join(directory, 'references', file), 'utf8')).join('\n');
      assert.ok(allReferences.includes(token), `${directory}: ${token}`);
    }
  }
});

test('workflow surfaces contain no contradictory status or landing language', () => {
  for (const directory of [claudeSkill, openCodeSkill]) {
    const files = [path.join(directory, 'SKILL.md')];
    for (const child of ['references', 'templates']) {
      files.push(...fs.readdirSync(path.join(directory, child)).map((file) => path.join(directory, child, file)));
    }
    const text = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    for (const forbidden of [/reviewers? move status/i, /reviewer sets Done/i, /commit per chunk/i, /branches first/i, /commit the chunk/i]) {
      assert.doesNotMatch(text, forbidden);
    }
    assert.match(text, /never commit[\s\S]{0,120}explicit user approval/i);
  }
});

test('no stale standards-checker discovery or tooling responsibility remains', () => {
  const roots = [path.join(repo, 'claude/plugins/orchestrate'), path.join(repo, 'opencode/skills/orchestrate')];
  const markdown = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name.endsWith('.md')) markdown.push(fs.readFileSync(target, 'utf8'));
    }
  };
  roots.forEach(visit);
  const text = markdown.join('\n');
  for (const stale of [/standards checker discovers/i, /discovers and checks the repo.s standards/i, /code-standards-checker[^\n]{0,100}runs (lint|quality|typecheck|build|tests)/i]) {
    assert.doesNotMatch(text, stale);
  }
});
