import { expect, mock, test } from 'claude-code/testing'

import { familyColor, modelLabel, splitTables, tableWidth } from '../hooks/look'

test('model ids read as short names', () => {
  expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(modelLabel('some-other-model[1m]')).toBe('some-other-model')
  expect(familyColor('Opus 5.5')).toBe('magenta')
  expect(familyColor('Haiku 4.5')).toBe('green')
  expect(familyColor('some-other-model')).toBe('gray')
})

test('tables are split out of prose so they can be drawn at full width', () => {
  const text = 'Intro line.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n```\n| not a table |\n```'
  expect(splitTables(text).map(part => part.isTable)).toEqual([false, true, false])
  expect(splitTables(text)[1]?.text).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  expect(splitTables(text)[2]?.text).toContain('| not a table |')
})

test('a table is measured by its widest cells', () => {
  // | Tool | Calls |  ->  1 + (4+3) + (5+3)
  expect(tableWidth('| Tool | Calls |\n| --- | --- |\n| Bash | 2151 |')).toBe(16)
  expect(tableWidth('| a | **bold text** |\n|---|---|')).toBe(1 + 4 + 12)
})

test('a reply opens with a model pill, every block is indented, notices get a command pill', async ($, on) => {
  const clock = mock.clock(on)
  const stored: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.id', () => ({ value: 's' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '[]', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine reply</Text>
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1 })) void _

  const reply = (isFirstOfReply: boolean) =>
    ({ plugin: 'prompt-timeline', component: 'AssistantMessage', props: { text: 'The fix is **in**.', isFirstOfReply } }) as const
  for (const surface of ['terminal', 'desktop'] as const) {
    const first = await $.ui.mount({ surface, requestId: 'reply-1', ...reply(true) })
    expect(await first.find({ text: ' ◆ Sonnet 5.5 ' })).toBeDefined()
    expect(await first.find({ text: 'effort high' })).toBeDefined()
    expect(await first.find({ type: 'Markdown' })).toBeDefined()
    await first.unmount()
    const later = await $.ui.mount({ surface, ...reply(false) })
    expect(await later.find({ type: 'Markdown' })).toBeDefined()
    expect(await later.find({ text: 'engine reply' })).toBeUndefined()
    await later.unmount()
  }

  // A later switch does not relabel a reply already drawn.
  await clock.advance(1)
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'claude-haiku-4-5', effort: 'low', messageCount: 3 })) void _
  // After a resume the reply may be drawn under a new id; its text still finds its tag.
  const redrawn = await $.ui.mount({ surface: 'terminal', requestId: 'resumed-1', ...reply(true) })
  expect(await redrawn.find({ text: ' ◆ Sonnet 5.5 ' })).toBeDefined()
  await redrawn.unmount()
  expect(stored['replies:s']).toEqual({ 'The fix is **in**.': { model: 'Sonnet 5.5', effort: 'high' } })
  const fresh = await $.ui.mount({
    surface: 'terminal',
    requestId: 'reply-2',
    plugin: 'prompt-timeline',
    component: 'AssistantMessage',
    props: { text: 'A newer reply.', isFirstOfReply: true },
  })
  expect(await fresh.find({ text: ' ◆ Haiku 4.5 ' })).toBeDefined()
  expect(await fresh.find({ text: 'effort low' })).toBeDefined()
  await fresh.unmount()

  const notice = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'InfoNotice',
    props: { text: 'Continue your session in Claude Code Desktop', command: '/desktop' },
  })
  expect(await notice.find({ text: ' /desktop ' })).toBeDefined()
  await notice.unmount()
})

test('a Bash card leads with its description and shows the command as one dim line', async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  const row = (input: Record<string, string>, isErrored = false) =>
    ({
      plugin: 'prompt-timeline',
      component: 'ToolUse',
      requestId: 'b1',
      props: { tool_use_id: 'b1', tool: 'Bash', input, isRunning: false, isErrored, isInterrupted: false },
    }) as const

  for (const surface of ['terminal', 'desktop'] as const) {
    const card = await $.ui.mount({ surface, ...row({ command: 'cd x && npm test\necho done\necho again', description: 'Run the tests' }) })
    expect(await card.find({ text: 'Run the tests' })).toBeDefined()
    expect(await card.find({ text: ' Bash ' })).toBeDefined()
    expect(await card.find({ text: '  $ cd x && npm test  (+2 lines)' })).toBeDefined()
    await card.unmount()

    const bare = await $.ui.mount({ surface, ...row({ command: 'ls' }) })
    expect(await bare.find({ text: 'engine row' })).toBeDefined()
    await bare.unmount()
    const reindex = await $.ui.mount({ surface, ...row({ command: 'node build-semantic-index.cjs .', description: 'Rebuild' }) })
    expect(await reindex.find({ text: 'engine row' })).toBeDefined()
    await reindex.unmount()
  }
})
