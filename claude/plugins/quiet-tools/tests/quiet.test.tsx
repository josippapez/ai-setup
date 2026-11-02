import { describe, expect, test } from 'claude-code/testing'

import { groupLine, summary } from '../hooks/register'

const engineRow = (text: string) => () => ({ type: 'Text', props: {}, children: [text] }) as never

const bash = (isExpanded: boolean) => ({
  tool_use_id: 't1',
  tool: 'Bash',
  input: { command: 'git status\necho hi' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  isExpanded,
  output: { stdout: 'M a.ts\n', stderr: '', interrupted: false },
})

describe('quiet tools', () => {
  test('a tool call draws one line naming it', async ($, on) => {
    on('ui.render', engineRow('Bash(git status) full row'))
    const ui = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolUse', requestId: 't1', props: bash(false) })
    expect(await ui.find({ type: 'Text', text: /· \$ git status/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /full row/ })).toBeUndefined()
    await ui.unmount()
  })

  test('its output is hidden', async ($, on) => {
    on('ui.render', engineRow('M a.ts'))
    const { output, tool_use_id, tool } = bash(false)
    const ui = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolResult', requestId: 't1', props: { tool_use_id, tool, output, isErrored: false, isExpanded: false } })
    expect(await ui.find({ type: 'Text', text: /M a\.ts/ })).toBeUndefined()
    await ui.unmount()
  })

  test('ctrl+o shows the full row and output', async ($, on) => {
    on('ui.render', engineRow('Bash(git status) full row'))
    const ui = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolUse', requestId: 't1', props: bash(true) })
    expect(await ui.find({ type: 'Text', text: /full row/ })).toBeDefined()
    await ui.unmount()
  })

  test('a failed call is marked', async ($, on) => {
    on('ui.render', engineRow('row'))
    const ui = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolUse', requestId: 't1', props: { ...bash(false), isErrored: true } })
    expect(await ui.find({ type: 'Text', text: /✗ \$ git status/ })).toBeDefined()
    await ui.unmount()
  })

  test('file tools name their file', () => {
    expect(summary('Edit', { file_path: '/repo/a.ts', old_string: 'x' })).toBe('Edit /repo/a.ts')
    expect(summary('TodoWrite', {})).toBe('TodoWrite')
  })

  test('clicking a call opens its full row and output', async ($, on) => {
    on('ui.render', engineRow('Bash(git status) full row'))
    const ui = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolUse', requestId: 't1', props: bash(false) })
    await ui.press({ key: 'call-t1' })
    expect(await ui.find({ type: 'Text', text: /full row/ })).toBeDefined()
    await ui.unmount()
  })

  test('a finished group is one line, and a click unfolds it', async ($, on) => {
    on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [(e.props as { isExpanded?: boolean }).isExpanded ? 'engine rows' : 'engine line'] }) as never)
    const calls = [{ tool_use_id: 'c1', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false }, { tool_use_id: 'c2', tool: 'Read', input: { file_path: '/a' }, isRunning: false, isErrored: false, isInterrupted: false }]
    const ui = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolGroup', requestId: 'g1', props: { calls, isActive: false, isExpanded: false, isCallsOnly: true } })
    expect(await ui.find({ type: 'Text', text: /▸ Ran 1 shell command, read 1 file/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /engine/ })).toBeUndefined()
    await ui.press({ key: 'group-g1' })
    expect(await ui.find({ type: 'Text', text: /engine rows/ })).toBeDefined()
    await ui.press({ key: 'fold-g1' })
    expect(await ui.find({ type: 'Text', text: /engine rows/ })).toBeUndefined()
    await ui.unmount()
  })

  test('group lines name MCP servers and plurals', () => {
    const c = (tool: string) => ({ tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false })
    expect(groupLine([c('Grep'), c('Glob'), c('mcp__plugin_wings_wings__tasks__log')])).toBe('Searched for 2 patterns, called wings')
  })

  test('an opened call shows its output with a fold bar under it', async ($, on) => {
    on('ui.render', engineRow('M a.ts'))
    const { output, tool_use_id, tool } = bash(false)
    const row = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolUse', requestId: 't9', props: { ...bash(false), tool_use_id: 't9' } })
    await row.press({ key: 'call-t9' })
    const result = await $.ui.mount({ plugin: 'quiet-tools', surface: 'terminal', component: 'ToolResult', requestId: 't9', props: { tool_use_id: 't9', tool, output, isErrored: false, isExpanded: false } })
    expect(await result.find({ type: 'Text', text: /M a\.ts/ })).toBeDefined()
    await result.press({ key: 'fold-t9' })
    expect(await result.find({ type: 'Text', text: /M a\.ts/ })).toBeUndefined()
    await row.unmount()
    await result.unmount()
  })
})
