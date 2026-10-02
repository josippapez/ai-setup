import { expect, test } from 'claude-code/testing'

const issue = (id: string, status: string, title: string) => `---\nid: ${id}\nepic: e\nstatus: ${status}\nwave: 1\n---\n# ${title}\n`
const FILES: Record<string, string> = {
  '.orchestration/live/EPIC.md': '---\nsessions: []\n---\n# Live epic\n',
  '.orchestration/live/issues/01-a.md': issue('01-a', 'Done', 'First chunk'),
  '.orchestration/live/issues/02-b.md': issue('02-b', 'In Progress', 'Second chunk'),
  '.orchestration/old/EPIC.md': '---\nsessions: []\n---\n# Old epic\n',
  '.orchestration/old/issues/01-c.md': issue('01-c', 'Done', 'Old chunk'),
}
const DIRS: Record<string, string[]> = {
  '.orchestration': ['live', 'old', 'PROJECT.md'],
  '.orchestration/live/issues': ['01-a.md', '02-b.md'],
  '.orchestration/old/issues': ['01-c.md'],
}
// The engine hands fs hooks absolute paths, resolved against the working directory.
const rel = (path: string) => path.slice(path.indexOf('.orchestration'))
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const PANE = { title: 'Epics', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

test('the pane shows open epics with chunk status and hides closed ones until asked', async ($, on) => {
  on('fs.exists', (_, e) => ({ value: rel(e.path) in FILES || rel(e.path) in DIRS }))
  on('fs.read', (_, e) => ({ value: FILES[rel(e.path)] ?? '' }))
  on('fs.list', (_, e) => ({
    value: (DIRS[rel(e.path)] ?? []).map(name => ({ name, kind: name.endsWith('.md') ? 'file' : 'dir', size: 0, mtimeMs: 0, isLink: false }) as const),
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.command.run({ ...RUN, command: 'epics', args: '' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestrate', surface, component: 'Pane', requestId: 'epics', props: PANE })
    expect(await ui.find({ text: 'Live epic' })).toBeDefined()
    expect(await ui.find({ text: 'Second chunk' })).toBeDefined()
    expect(await ui.find({ text: /In Progress/ })).toBeDefined()
    expect(await ui.find({ text: /Old epic/ })).toBeUndefined()

    await ui.press({ key: 'toggle-done' })
    expect(await ui.find({ text: /Old epic · 1 chunk/ })).toBeDefined()
    await ui.press({ key: 'toggle-done' })
    await ui.unmount()
  }
})
