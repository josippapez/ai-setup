import { expect, test } from 'claude-code/testing'

import { describe } from '../hooks/cards'

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
    detail: 'Looks good',
  })
})

test('rows other plugins draw, and Bash without a description, keep their own look', () => {
  expect(describe('mcp__plugin_feedback_feedback__collect_feedback', { title: 'x' })).toBeNull()
  expect(describe('Bash', { command: 'ls' })).toBeNull()
  expect(describe('Bash', { command: 'node build-semantic-index.cjs .', description: 'Rebuild' })).toBeNull()
  expect(describe('Bash', { command: 'npm test\necho done', description: 'Run tests' })?.detail).toBe('$ npm test  (+1 lines)')
})
