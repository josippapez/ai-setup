'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { walkDirectory } = require('./fs-utils.cjs');

test('walkDirectory skips the .orchestration store and other noise dirs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skipdirs-'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, '.orchestration', 'epic', 'issues'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'real.md'), '# real');
  fs.writeFileSync(path.join(root, '.orchestration', 'PROJECT.md'), '# store');
  fs.writeFileSync(path.join(root, '.orchestration', 'epic', 'issues', '01.md'), '# chunk');
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'readme.md'), '# dep');

  const seen = [];
  walkDirectory(root, (p) => seen.push(path.relative(root, p)));

  assert.ok(seen.includes(path.join('docs', 'real.md')), 'real doc should be visited');
  assert.ok(!seen.some((p) => p.startsWith('.orchestration')), '.orchestration must be skipped');
  assert.ok(!seen.some((p) => p.startsWith('node_modules')), 'node_modules must be skipped');
});

test('walkDirectory skips .claude/worktrees but keeps other .claude and worktrees dirs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skipworktrees-'));
  fs.mkdirSync(path.join(root, '.claude', 'worktrees', 'agent-abc123'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'worktrees'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'worktrees', 'agent-abc123', 'README.md'), '# copy');
  fs.writeFileSync(path.join(root, '.claude', 'rules', 'custom.md'), '# rule');
  fs.writeFileSync(path.join(root, 'worktrees', 'doc.md'), '# unrelated');

  const seen = [];
  walkDirectory(root, (p) => seen.push(path.relative(root, p)));

  assert.ok(
    !seen.some((p) => p.startsWith(path.join('.claude', 'worktrees'))),
    '.claude/worktrees must be skipped',
  );
  assert.ok(seen.includes(path.join('.claude', 'rules', 'custom.md')), 'other .claude docs should be visited');
  assert.ok(seen.includes(path.join('worktrees', 'doc.md')), 'a non-.claude worktrees dir should be visited');
});
