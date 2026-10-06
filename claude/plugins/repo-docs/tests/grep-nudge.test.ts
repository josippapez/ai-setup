import { expect, test } from 'claude-code/testing'

import { NUDGE } from '../hooks/grep-nudge'

const OK = { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
const FIND_DOCS = 'mcp__plugin_repo-docs_repo-docs__find_docs'

test('a docs grep gets the find_docs reminder, other searches do not', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => OK)
  on('tool.call', { tool: 'Grep' }, () => ({ result: { mode: 'content', numFiles: 0, filenames: [] }, text: '' }))
  const bash = async (command: string) => (await $.tool.call({ tool: 'Bash', command })).context

  expect(await bash('rg -n "sidrena" src')).toBeUndefined()
  expect(await bash('rg -n -i "sidrena" .orchestration -g "*.md"')).toBeUndefined()
  expect(await bash('sed -n 1,40p docs/guides/setup.md')).toBeUndefined()
  expect(await bash('P="the repo docs are ignored, the rg is used instead"\nclaude -p "$P"')).toBeUndefined()
  expect(await bash('rtk rg -n -i "shopify cli" docs')).toEqual([NUDGE])
  expect((await $.tool.call({ tool: 'Grep', pattern: 'cascade', path: '/repo/docs' })).context).toEqual([NUDGE])
  // Two reminders a session at most.
  expect(await bash('grep -rn price README.md')).toBeUndefined()
})

test('a Grep scoped to markdown by glob gets the reminder', async ($, on) => {
  on('tool.call', { tool: 'Grep' }, () => ({ result: { mode: 'content', numFiles: 0, filenames: [] }, text: '' }))
  expect((await $.tool.call({ tool: 'Grep', pattern: 'price', glob: '*.md' })).context).toEqual([NUDGE])
})

test('no reminder once find_docs has been called', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => OK)
  on('tool.call', { tool: FIND_DOCS }, () => ({ result: [], text: '' }))

  await $.tool.call({ tool: FIND_DOCS, query: 'update prices' })
  expect((await $.tool.call({ tool: 'Bash', command: 'rg -n price docs/' })).context).toBeUndefined()
})
