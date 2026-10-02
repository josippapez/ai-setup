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
