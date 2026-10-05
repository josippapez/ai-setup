import { midTurnText, promptOf, withPrompt } from '../hooks/register'
import { expect, test } from 'claude-code/testing'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const PANE = { title: 'Timeline', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const message = (requestId: string, text: string, kind: 'composer' | 'task-notification' = 'composer') =>
  ({
    plugin: 'prompt-timeline',
    component: 'UserMessage',
    requestId,
    props: { text, origin: { kind }, isExpanded: true },
  }) as const

test('a prompt not saved yet draws as queued, other rows keep theirs, and an empty timeline stays out of the way', async ($, on) => {
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })

  // session.append is raised by the engine's storage, which the kit does not stand in for, so the
  // list stays empty here: cards draw unnumbered and the timeline shows its empty state.
  const row = await $.ui.mount({ surface: 'terminal', ...message('m1', 'first prompt') })
  expect(await row.find({ text: /Queued/ })).toBeDefined()
  expect(await row.find({ text: 'first prompt' })).toBeDefined()
  await row.unmount()
  const redrawn = await $.ui.mount({ surface: 'desktop', ...message('m1', 'first prompt\nsecond line') })
  expect(await redrawn.find({ text: /Queued/ })).toBeDefined()
  await redrawn.unmount()
  const command = await $.ui.mount({ surface: 'terminal', ...message('c1', '/reload-plugins') })
  expect(await command.find({ text: 'engine row' })).toBeDefined()
  await command.unmount()
  const notice = await $.ui.mount({ surface: 'terminal', ...message('n1', 'task finished', 'task-notification') })
  expect(await notice.find({ text: 'engine row' })).toBeDefined()
  await notice.unmount()

  await $.command.run({ ...RUN, command: 'timeline', args: '' })
  const pane = await $.ui.mount({ plugin: 'prompt-timeline', surface: 'terminal', component: 'Pane', requestId: 'timeline', props: PANE })
  expect(await pane.find({ text: '0 this session' })).toBeDefined()
  await pane.unmount()
  const band = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await band.find({ text: 'engine band' })).toBeDefined()
  expect(await band.find({ text: /timeline/ })).toBeUndefined()
  await band.unmount()
})

test('earlier prompts come from the transcript and get numbered cards, strip entries, and timeline rows', async ($, on) => {
  const ran: (readonly string[])[] = []
  on('session.start', () => ({ cwd: '/repo' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('store.get', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('process.run', (_, e) => {
    ran.push(e.argv)
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify([{ id: 'u1', text: 'first prompt' }, { id: 'u2', text: 'second prompt\nmore' }]),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  expect(ran[0]?.at(-1)).toBe('sess-1')

  // The row is drawn under an id that is not the saved row's; the text still finds it.
  const card = await $.ui.mount({ surface: 'terminal', ...message('drawn-2', 'second prompt\nmore') })
  expect(await card.find({ text: '#2' })).toBeDefined()
  await card.unmount()
  const again = await $.ui.mount({ surface: 'terminal', ...message('drawn-2', 'second prompt\nmore') })
  expect(await again.find({ text: '#2' })).toBeDefined()
  await again.unmount()

  const band = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await band.find({ text: /#1 first prompt/ })).toBeDefined()
  expect(await band.find({ text: /#2 second prompt/ })).toBeDefined()
  await band.unmount()

  await $.command.run({ ...RUN, command: 'timeline', args: '' })
  const pane = await $.ui.mount({ plugin: 'prompt-timeline', surface: 'terminal', component: 'Pane', requestId: 'timeline', props: PANE })
  expect(await pane.find({ text: '2 this session' })).toBeDefined()
  expect(await pane.find({ text: 'second prompt' })).toBeDefined()
  await pane.unmount()

  // A reload reads the transcript again; prompts must not be listed twice.
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  const reloaded = await $.ui.mount({ plugin: 'prompt-timeline', surface: 'terminal', component: 'Pane', requestId: 'timeline', props: PANE })
  expect(await reloaded.find({ text: '2 this session' })).toBeDefined()
  await reloaded.unmount()
})

test('a message typed while a turn runs is read back out of its stored rendering', () => {
  const rendered =
    '<system-reminder>\nThe user sent a new message while you were working:\ni have installed shadow mount+\n\nThis is how Claude Code surfaces messages the user sends mid-turn.'
  expect(midTurnText(rendered)).toBe('i have installed shadow mount+')
  expect(midTurnText('<system-reminder>\nsomething else')).toBe('')
})

test('a prompt the startup transcript read already listed is not added again', () => {
  const listed = [{ id: 'u1', text: 'first prompt' }]
  expect(withPrompt({ id: 'u1', text: 'first prompt' })(listed)).toEqual(listed)
  expect(withPrompt({ id: 'u2', text: 'second' })(listed)).toEqual([...listed, { id: 'u2', text: 'second' }])
})

test('a message typed while a turn runs is saved from its queued_command delivery, already drawn', () => {
  const rendering = [
    { type: 'text', text: '<system-reminder>\nThe user sent a new message while you were working:\nDo i need to send a message?\n\nThis is how Claude Code surfaces messages the user sends mid-turn.' },
  ]
  expect(promptOf({ door: 'delivery', uuid: 'd1', message: { name: 'queued_command', content: rendering } })).toEqual({
    id: 'd1',
    text: 'Do i need to send a message?',
    isDrawn: true,
  })
  expect(promptOf({ door: 'prompt', uuid: 'p1', message: { content: [{ type: 'text', text: 'hi' }] } })).toEqual({ id: 'p1', text: 'hi' })
  expect(promptOf({ door: 'attachment', uuid: 'a1', message: { name: 'output_style', content: rendering } })).toBeUndefined()
})
