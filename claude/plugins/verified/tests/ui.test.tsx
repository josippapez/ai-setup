import { expect, test } from 'claude-code/testing'

const BLOCK = [
  'verified: your answer asserts 2 things nothing in this session backs.',
  '  - [path-missing] "a/b.md" — needs that path to exist',
  '  - [version] "v1.2.3" — nothing printed it',
  '',
  'Go run the check.',
].join('\n')
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const

test('a verified block shows a toast and a band listing the claims', async ($, on) => {
  const toasts: string[] = []
  on('classic.Stop', () => ({ block: BLOCK }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.classic.Stop({ stop_hook_active: false })

  expect(toasts).toEqual(['verified sent the answer back: 2 unbacked claims'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'verified', surface, ...BAND })
    const claims = await ui.findAll({ type: 'Text', text: /^\[/ })
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    expect(claims.map(one => one.text)).toEqual(['[path-missing] "a/b.md" — needs that path to exist', '[version] "v1.2.3" — nothing printed it'])
    await ui.unmount()
  }
})

test('Dismiss hides the band', async ($, on) => {
  on('classic.Stop', () => ({ block: BLOCK }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  await $.classic.Stop({ stop_hook_active: false })
  const ui = await $.ui.mount({ plugin: 'verified', surface: 'terminal', ...BAND })
  await ui.press({ key: 'dismiss' })
  expect(await ui.find({ text: /redid/ })).toBeUndefined()
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
  await ui.unmount()
})
