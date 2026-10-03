import { expect, test } from 'claude-code/testing'

import { changedBlock } from '../hooks/replay'

test('the changed block keeps three context lines either side', () => {
  const before = ['a', 'b', 'c', 'd', 'old', 'e', 'f', 'g', 'h'].join('\n')
  const after = ['a', 'b', 'c', 'd', 'new', 'newer', 'e', 'f', 'g', 'h'].join('\n')
  expect(changedBlock(before, after)).toEqual({ from: 1, head: ['b', 'c', 'd'], removed: ['old'], added: ['new', 'newer'], tail: ['e', 'f', 'g'] })
})

test('a turn that edited a file leaves a hint and a side-by-side replay', async ($, on) => {
  let file = 'one\ntwo\nthree'
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: file }))
  on('tool.call', { tool: 'Edit' }, () => {
    file = 'one\nTWO\nthree'
    return { result: {}, text: 'ok' }
  })
  on('turn.complete', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })

  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'two', new_string: 'TWO' })
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })

  const band = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await band.find({ text: /1 edit in 1 file last turn/ })).toBeDefined()
  await band.unmount()

  const ran = await $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 }, command: 'replay', args: '' })
  expect(ran.text).toBe('Replay opened.')
  const pane = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'replay',
    props: { title: 'Replay', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  expect(await pane.find({ text: /2 two/ })).toBeDefined()
  expect(await pane.find({ text: /2 TWO/ })).toBeDefined()
  expect(await pane.find({ text: '1/1' })).toBeDefined()
  await pane.unmount()
})
