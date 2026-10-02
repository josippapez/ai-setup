import { expect, mock, test } from 'claude-code/testing'

const COLLECT = 'mcp__plugin_feedback_feedback__collect_feedback'
const STORE = [
  { id: 'aaaa1111', createdAt: '2026-10-01T09:00:00.000Z', kind: 'bug', severity: 'high', title: 'old bug', details: 'd', cwd: '/x/ai-setup' },
  { id: 'bbbb2222', createdAt: '2026-10-02T09:00:00.000Z', kind: 'idea', severity: 'low', title: 'new idea', details: 'd', area: 'pane', cwd: '/x/ai-setup' },
]
  .map(one => JSON.stringify(one))
  .join('\n')
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const PANE = { title: 'Feedback', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

test('/fb logs through the MCP tool and toasts the result', async ($, on) => {
  const calls: unknown[] = []
  const toasts: string[] = []
  on('tool.call', { tool: COLLECT }, (_, e) => {
    calls.push(e)
    return { result: {}, text: 'Recorded feedback cccc3333: [pain_point/medium] hooks are slow' }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))

  const ran = await $.command.run({ ...RUN, command: 'fb', args: 'hooks are slow' })

  expect(ran.text).toBe('Recorded feedback cccc3333: [pain_point/medium] hooks are slow')
  expect(calls).toEqual([expect.objectContaining({ kind: 'pain_point', title: 'hooks are slow', details: 'hooks are slow' })])
  expect(toasts).toEqual(['Recorded feedback cccc3333: [pain_point/medium] hooks are slow'])
})

test('/fb with no text shows usage and logs nothing', async ($, on) => {
  let called = false
  on('tool.call', { tool: COLLECT }, () => {
    called = true
    return { result: {} }
  })

  const ran = await $.command.run({ ...RUN, command: 'fb', args: '  ' })

  expect(ran.text).toBe('Usage: /fb <what went wrong>')
  expect(called).toBe(false)
})

test('the pane lists entries newest first and filters by kind', async ($, on) => {
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: STORE }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.command.run({ ...RUN, command: 'feedback', args: '' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'feedback', surface, component: 'Pane', requestId: 'feedback', props: PANE })
    const titles = await ui.findAll({ type: 'Text', text: /old bug|new idea/ })
    expect(titles.map(one => one.text)).toEqual(['new idea', 'old bug'])

    await ui.press({ key: 'filter-bug' })
    const filtered = await ui.findAll({ type: 'Text', text: /old bug|new idea/ })
    expect(filtered.map(one => one.text)).toEqual(['old bug'])

    await ui.press({ key: 'filter-all' })
    await ui.unmount()
  }
})

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('logging shows a card above the prompt and updates the footer count', async ($, on) => {
  let store = ''
  const statuses: (string | undefined)[] = []
  on('fs.exists', () => ({ value: store !== '' }))
  on('fs.read', () => ({ value: store }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  on('tool.call', { tool: COLLECT }, () => {
    store = `${STORE}\n${JSON.stringify({ id: 'cccc3333', createdAt: '2026-10-03T09:00:00.000Z', kind: 'bug', severity: 'high', title: 'just now', details: 'd', cwd: '/x' })}`
    return { result: {}, text: 'Recorded feedback cccc3333: [bug/high] just now' }
  })

  await $.command.run({ ...RUN, command: 'fb', args: 'just now' })

  expect(statuses.at(-1)).toBe('3 open · 2 high · 0 medium · 1 low · /feedback to view')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'feedback', surface, ...BAND })
    expect(await ui.find({ text: /Feedback logged · cccc3333/ })).toBeDefined()
    expect(await ui.find({ text: 'just now' })).toBeDefined()
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'feedback', surface: 'terminal', ...BAND })
  await ui.press({ key: 'dismiss-logged' })
  expect(await ui.find({ text: /Feedback logged/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane shows open entries by default and resolved ones with their resolution', async ($, on) => {
  const resolved = JSON.stringify({ op: 'update', id: 'aaaa1111', status: 'resolved', resolution: 'fixed in 0.4.6', updatedAt: '2026-10-03T09:00:00.000Z' })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: `${STORE}\n${resolved}` }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.command.run({ ...RUN, command: 'feedback', args: '' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'feedback', surface, component: 'Pane', requestId: 'feedback', props: PANE })
    expect((await ui.findAll({ type: 'Text', text: /old bug|new idea/ })).map(one => one.text)).toEqual(['new idea'])

    await ui.press({ key: 'show-resolved' })
    expect((await ui.findAll({ type: 'Text', text: /old bug|new idea/ })).map(one => one.text)).toEqual(['old bug'])
    expect(await ui.find({ text: /fixed in 0\.4\.6/ })).toBeDefined()

    await ui.press({ key: 'show-open' })
    await ui.unmount()
  }
})

test('feedback tool calls draw as compact transcript rows', async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  const row = (tool: string, input: Record<string, string>) => ({
    plugin: 'feedback',
    component: 'ToolUse',
    requestId: `t-${tool}`,
    props: { tool_use_id: `t-${tool}`, tool, input, isRunning: false, isErrored: false, isInterrupted: false },
  }) as const

  for (const surface of ['terminal', 'desktop'] as const) {
    const logged = await $.ui.mount({ surface, ...row(COLLECT, { kind: 'bug', severity: 'high', title: 'hooks are slow', details: 'd' }) })
    expect(await logged.find({ text: 'Log feedback' })).toBeDefined()
    expect(await logged.find({ text: ' HIGH ' })).toBeDefined()
    expect(await logged.find({ text: 'hooks are slow' })).toBeDefined()
    await logged.unmount()

    const resolved = await $.ui.mount({
      surface,
      ...row('mcp__plugin_feedback_feedback__update_feedback', { id: 'aaaa1111', status: 'resolved', resolution: 'fixed' }),
    })
    expect(await resolved.find({ text: '✓ resolved' })).toBeDefined()
    expect(await resolved.find({ text: /→ fixed/ })).toBeDefined()
    await resolved.unmount()

    const other = await $.ui.mount({ surface, ...row('Bash', { command: 'ls' }) })
    expect(await other.find({ text: 'engine row' })).toBeDefined()
    await other.unmount()
  }
})

test('the footer follows writes made outside this session', async ($, on) => {
  const clock = mock.clock(on)
  let store = STORE
  let mtimeMs = 1
  const statuses: (string | undefined)[] = []
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: store }))
  on('fs.stat', () => ({ value: { kind: 'file', size: store.length, mtimeMs, isLink: false } }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/repo' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  expect(statuses.at(-1)).toBe('2 open · 1 high · 0 medium · 1 low · /feedback to view')

  store = `${STORE}\n${JSON.stringify({ op: 'update', id: 'aaaa1111', status: 'resolved' })}`
  mtimeMs = 2
  await clock.advance(3000)
  expect(statuses.at(-1)).toBe('1 open · 0 high · 0 medium · 1 low · /feedback to view')
})

test('the logged card goes away on its own after a few seconds', async ($, on) => {
  const clock = mock.clock(on)
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: STORE }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  on('tool.call', { tool: COLLECT }, () => ({ result: {}, text: 'Recorded feedback bbbb2222: [idea/low] new idea' }))

  await $.command.run({ ...RUN, command: 'fb', args: 'new idea' })
  const ui = await $.ui.mount({ plugin: 'feedback', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /Feedback logged/ })).toBeDefined()

  await clock.advance(8000)
  expect(await ui.find({ text: /Feedback logged/ })).toBeUndefined()
  await ui.unmount()
})
