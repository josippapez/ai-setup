import { expect, test } from 'claude-code/testing'

test('WebFetch and Monitor are listed in the prompt, other deferred tools stay deferred', async ($, on) => {
  on('tool.describe', (_, e) => ({ description: e.description, isDeferred: true }))
  const provider = { plugin: 'builtin', tier: 'user' } as const
  const describe = (tool: string) => $.tool.describe({ tool, description: 'd', isDeferred: true, provider })

  expect((await describe('WebFetch')).isDeferred).toBe(false)
  expect((await describe('Monitor')).isDeferred).toBe(false)
  expect((await describe('TaskStop')).isDeferred).toBe(true)
})
