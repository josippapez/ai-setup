import { expect, test } from 'claude-code/testing'

test('find_docs is listed in the prompt instead of behind ToolSearch', async ($, on) => {
  on('tool.describe', (_, e) => ({ description: e.description, isDeferred: true }))
  const provider = { plugin: 'mcp:repo-docs', tier: 'user' } as const
  const describe = (tool: string) => $.tool.describe({ tool, description: 'Search docs', isDeferred: true, provider })

  expect(await describe('mcp__plugin_repo-docs_repo-docs__find_docs')).toEqual({ description: 'Search docs', isDeferred: false })
  expect((await describe('mcp__plugin_repo-docs_repo-docs__read_doc')).isDeferred).toBe(true)
})
