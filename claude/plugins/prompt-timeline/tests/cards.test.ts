import { expect, test } from 'claude-code/testing'

import { describe, shell, shellDetail } from '../hooks/cards'

test('each tool reads as one label and a short title', () => {
  expect(describe('Read', { file_path: '/Users/me/repo/src/app.ts', offset: 10, limit: 20 })).toEqual({
    label: 'Read',
    color: 'blue',
    title: 'app.ts  lines 11–30',
    detail: '~/repo/src',
  })
  expect(describe('Edit', { file_path: '/Users/me/repo/README.md' })?.title).toBe('README.md')
  expect(describe('Grep', { pattern: 'useAuth', path: 'src' })?.title).toBe('"useAuth"')
  expect(describe('WebFetch', { url: 'https://example.com/docs', prompt: 'find the flag' })?.title).toBe('example.com/docs')
  expect(describe('WebSearch', { query: 'ink box border' })?.title).toBe('Search "ink box border"')
  expect(describe('Skill', { skill: 'dev-core:plugin-authoring' })).toEqual({ label: 'Skill', color: 'magenta', title: '/plugin-authoring', detail: 'from dev-core' })
  expect(describe('Skill', { skill: 'review', args: 'PR 12' })?.detail).toBe('PR 12')
  expect(describe('mcp__plugin_repo-docs_repo-docs__find_docs', { query: 'reindex lock' })).toEqual({ label: 'Docs', color: 'yellow', title: 'Search "reindex lock"' })
  expect(describe('mcp__plugin_repo-docs_repo-docs__read_doc', { path: 'docs/setup.md' })?.title).toBe('docs/setup.md')
  expect(describe('mcp__plugin_repo-docs_repo-docs__find_libs', { query: 'zod' })).toEqual({ label: 'Packages', color: 'yellow', title: 'Package "zod"' })
  expect(describe('mcp__plugin_repo-docs_codegraph__codegraph_explore', { query: 'describe cards.ts' })).toEqual({ label: 'Code', color: 'yellow', title: 'describe cards.ts' })
  expect(describe('ToolSearch', { query: 'select:WebFetch' })?.title).toBe('Load WebFetch')
})

test('browser and other MCP tools get a readable action instead of the long tool name', () => {
  expect(describe('mcp__plugin_dev-core_chrome-devtools__navigate_page', { url: 'http://localhost:3000' })).toEqual({
    label: 'Browser',
    color: 'magenta',
    title: 'Open http://localhost:3000',
    detail: undefined,
  })
  expect(describe('mcp__chrome-devtools__click', { uid: '1_23' })?.title).toBe('Click 1_23')
  expect(describe('mcp__plugin_dev-core_chrome-devtools__evaluate_script', { function: '() => document.title\n' })?.detail).toBe(
    '() => document.title',
  )
  expect(describe('mcp__ado__repo_pull_request_thread_write', { content: 'Looks good' })).toEqual({
    label: 'Ado',
    color: 'blue',
    title: 'Repo pull request thread write',
    body: 'Looks good',
  })
  // The real call shape: action, ids, a file range and the comment text.
  expect(
    describe('mcp__ado__repo_pull_request_thread_write', {
      action: 'create',
      repositoryId: 'Core.NX',
      pullRequestId: 6179,
      filePath: '/tools/nx-plugin/src/orvalConfig.ts',
      changeTrackingId: 30,
      rightFileStartLine: 107,
      content: 'nit: this comment now also sits over the enquiry search\nmore',
    }),
  ).toEqual({
    label: 'Ado',
    color: 'blue',
    title: 'Repo pull request thread write · create',
    detail: '#6179 · orvalConfig.ts:107',
    body: 'nit: this comment now also sits over the enquiry search\nmore',
  })
  // Lists of ids, branches, design nodes and queries keep what tells calls apart.
  expect(describe('mcp__ado__wit_work_item', { action: 'get_batch', project: 'P', ids: [1, 2, 3, 4, 5] })?.detail).toBe('#1, #2, #3 +2')
  expect(describe('mcp__ado__repo_pull_request', { action: 'list', project: 'P', targetRefName: 'refs/heads/develop', status: 'Active' })?.detail).toBe(
    'into develop · Active',
  )
  expect(describe('mcp__ado__wit_query', { action: 'wiql', project: 'P', wiql: 'SELECT [System.Id]' })?.body).toBe('```\nSELECT [System.Id]\n```')
  expect(describe('mcp__claude_ai_Figma__get_metadata', { fileKey: 'abc', nodeId: '223:1177' })).toMatchObject({ label: 'Figma', detail: 'node 223:1177' })
  expect(describe('mcp__chrome-devtools__navigate_page', { type: 'reload' })?.title).toBe('Reload page')
  expect(describe('mcp__chrome-devtools__evaluate_script', { function: '() => {\n  return document.title\n}' })?.detail).toBe('return document.title')
  expect(describe('mcp__chrome-devtools__wait_for', { text: ['Saved', 'Error'] })?.title).toBe('Wait for "Saved" or "Error"')
  expect(describe('Edit', { file_path: '/r/a.ts', old_string: 'a\nb', new_string: 'c' })?.title).toBe('a.ts  −2 +1 lines')
  expect(describe('SendMessage', { to: 'abc', summary: 'Add spans', message: 'x' })).toMatchObject({ title: 'Message: Add spans', detail: 'to abc' })
})

test('rows other plugins draw keep their own look; Bash without a description uses its command as the title', () => {
  expect(describe('mcp__plugin_feedback_feedback__collect_feedback', { title: 'x' })).toBeNull()
  expect(describe('Bash', { command: 'ls' })).toMatchObject({ label: 'Bash', title: '$ ls' })
  expect(describe('Bash', { command: 'node build-semantic-index.cjs .', description: 'Rebuild' })).toBeNull()
  expect(describe('Bash', { command: 'npm test\necho done', description: 'Run tests' })?.detail).toBe('$ npm test  (+1 lines)')
})

test('a shell command drops its leading cd, shortens paths and splits a chain into steps', () => {
  expect(shell("cd /Users/me/repo/plugins/prompt-timeline; cat >> tests/a.ts <<'EOF'\nx\nEOF")).toEqual({
    where: 'prompt-timeline',
    steps: ["cat >> tests/a.ts <<'EOF'"],
    more: 2,
  })
  expect(shell('ls /Users/me/Desktop').steps).toEqual(['ls ~/Desktop'])
  expect(shell('S=/private/tmp/claude-501/-Users-me-repo/4566aef8-6a8e-416f-bc4f-a8b5a4ec6091/scratchpad; rtk git log | head -3 && echo "a; b"').steps).toEqual([
    'S=scratchpad',
    'git log | head -3',
    'echo "a; b"',
  ])
  expect(shellDetail('cd /r/app && a; b; c; d; e')).toBe('app $ a\n  b\n  c\n  d  (+1 more steps)')
  // Loops stay whole and section markers drop out.
  expect(shell('echo "=== rules:"; for f in a b; do echo $f; cat $f; done; ls').steps).toEqual(['for f in a b; do echo $f; cat $f; done', 'ls'])
})
