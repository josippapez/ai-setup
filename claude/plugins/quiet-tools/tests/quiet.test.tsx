import { describe, expect, test } from 'claude-code/testing'

import { summary } from '../hooks/register'

const engineRow = (text: string) => () => ({ type: 'Text', props: {}, children: [text] }) as never

const call = (tool: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  tool_use_id: 't1',
  tool,
  input,
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  isExpanded: false,
  output: { stdout: 'M a.ts\n', stderr: '', interrupted: false },
  ...extra,
})

describe('quiet tools', () => {
  test('a Bash call keeps the engine row', async ($, on) => {
    on('ui.render', engineRow('Bash(git status) full row'))
    const ui = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolUse', requestId: 't1', props: call('Bash', { command: 'git status' }) })
    expect(await ui.find({ type: 'Text', text: /full row/ })).toBeDefined()
    await ui.unmount()
  })

  test('a Bash call keeps its output', async ($, on) => {
    on('ui.render', engineRow('M a.ts'))
    const result = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolResult', requestId: 't1', props: { tool_use_id: 't1', tool: 'Bash', output: {}, isErrored: false, isExpanded: false } })
    expect(await result.find({ type: 'Text', text: /M a\.ts/ })).toBeDefined()
    await result.unmount()
  })

  test('a skill call is one bold magenta line', async ($, on) => {
    on('ui.render', engineRow('row'))
    const ui = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolUse', requestId: 't2', props: call('Skill', { skill: 'validate-work-item' }) })
    const row = await ui.find({ type: 'Text', text: /· Skill validate-work-item/ })
    expect([row?.props?.color, row?.props?.bold]).toEqual(['magenta', true])
    await ui.unmount()
  })

  test('an MCP call is one bold cyan line naming the server', async ($, on) => {
    on('ui.render', engineRow('row'))
    const ui = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolUse', requestId: 't3', props: call('mcp__plugin_repo-docs_repo-docs__find_docs', { query: 'install' }) })
    const row = await ui.find({ type: 'Text', text: /· repo-docs › find_docs install/ })
    expect(row?.props?.color).toBe('cyan')
    await ui.unmount()
  })

  test('a failed skill call is red', async ($, on) => {
    on('ui.render', engineRow('row'))
    const ui = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolUse', requestId: 't4', props: call('Skill', { skill: 'x' }, { isErrored: true }) })
    expect((await ui.find({ type: 'Text', text: /✗ Skill x/ }))?.props?.color).toBe('error')
    await ui.unmount()
  })

  test('summary names skill and MCP calls', () => {
    expect(summary('Skill', { skill: 'opensrc' })).toBe('Skill opensrc')
    expect(summary('mcp__wings__tasks__log', { key: 'AIS-1', text: 'a\nb' })).toBe('wings › tasks__log AIS-1')
  })

  test('clicking an MCP call opens its output with a fold bar', async ($, on) => {
    on('ui.render', engineRow('hit list'))
    const tool = 'mcp__wings__tasks__list'
    const row = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolUse', requestId: 't9', props: call(tool, {}, { tool_use_id: 't9' }) })
    const result = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolResult', requestId: 't9', props: { tool_use_id: 't9', tool, output: {}, isErrored: false, isExpanded: false } })
    expect(await result.find({ type: 'Text', text: /hit list/ })).toBeUndefined()
    await row.press({ key: 'call-t9' })
    expect(await result.find({ type: 'Text', text: /hit list/ })).toBeDefined()
    await result.press({ key: 'fold-t9' })
    expect(await result.find({ type: 'Text', text: /hit list/ })).toBeUndefined()
    await row.unmount()
    await result.unmount()
  })
})
