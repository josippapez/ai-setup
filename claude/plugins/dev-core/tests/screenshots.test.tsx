import { expect, test } from 'claude-code/testing'

const TOOL = 'mcp__plugin_dev-core_chrome-devtools__take_screenshot'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAYAAADDhn8LAAABGUlEQVR4nO3ToREAIAzAwO6/dFmAiwXx4n1MZmcWuJvXAfAzg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCIQDLHis1qfjJ1QAAAAASUVORK5CYII='
const result = (output: unknown) =>
  ({
    plugin: 'dev-core',
    component: 'ToolResult',
    requestId: 'shot',
    props: { tool_use_id: 'shot', tool: TOOL, output, isErrored: false },
  }) as const

test('an inline PNG screenshot draws as an image in the terminal, at its own shape', async ($, on) => {
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine result</Text>
  })
  const output = [{ type: 'text', text: '# take_screenshot response' }, { type: 'image', data: PNG, mimeType: 'image/png' }]

  const ui = await $.ui.mount({ surface: 'terminal', ...result(output) })
  const image = await ui.find({ type: 'Image' })
  expect(image).toBeDefined()
  expect(await ui.find({ text: '200×100' })).toBeDefined()
  await ui.unmount()

  const desktop = await $.ui.mount({ surface: 'desktop', ...result(output) })
  expect(await desktop.find({ text: 'engine result' })).toBeDefined()
  await desktop.unmount()
})

test('a screenshot saved to a file draws from that file; a JPEG keeps the default row', async ($, on) => {
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine result</Text>
  })
  const saved = await $.ui.mount({ surface: 'terminal', ...result([{ type: 'text', text: 'Saved screenshot to /tmp/shot.png.' }]) })
  expect(await saved.find({ type: 'Image' })).toBeDefined()
  expect(await saved.find({ text: '/tmp/shot.png' })).toBeDefined()
  await saved.unmount()

  const jpeg = await $.ui.mount({ surface: 'terminal', ...result([{ type: 'image', data: 'abc', mimeType: 'image/jpeg' }]) })
  expect(await jpeg.find({ text: 'engine result' })).toBeDefined()
  await jpeg.unmount()
})
