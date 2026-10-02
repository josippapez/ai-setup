import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Epic } from '../types'

const PANE = 'epics'
const STORE = '.orchestration'
const STATUS_COLOR: Record<string, string> = {
  Todo: 'gray',
  'In Progress': 'yellow',
  'In Review': 'cyan',
  Done: 'green',
  Canceled: 'gray',
}
const epics = atom({ plugin: 'orchestrate', key: 'epics' } as const, [] as Epic[])
const showDone = atom({ plugin: 'orchestrate', key: 'showDone' } as const, false)

const field = (text: string, key: string) => text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''
const heading = (text: string) => text.match(/^# (.+)$/m)?.[1]?.trim() ?? ''
const isClosed = (epic: Epic) => epic.issues.length > 0 && epic.issues.every(one => one.status === 'Done' || one.status === 'Canceled')

async function load($: EngineInterface) {
  if (!(await $.fs.exists(STORE))) return update($, epics, () => [])
  const found: Epic[] = []
  for (const dir of await $.fs.list(STORE)) {
    if (dir.kind !== 'dir' || !(await $.fs.exists(`${STORE}/${dir.name}/EPIC.md`))) continue
    const epicText = await $.fs.read(`${STORE}/${dir.name}/EPIC.md`)
    const issueDir = `${STORE}/${dir.name}/issues`
    const files = (await $.fs.exists(issueDir)) ? await $.fs.list(issueDir) : []
    const issues = []
    for (const file of files.filter(one => one.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name))) {
      const text = await $.fs.read(`${issueDir}/${file.name}`)
      issues.push({ id: field(text, 'id') || file.name, title: heading(text), status: field(text, 'status'), wave: field(text, 'wave') })
    }
    found.push({ slug: dir.name, title: heading(epicText) || dir.name, issues })
  }
  return update($, epics, () => found)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'epics', description: 'Show this repo\'s orchestration epics and their chunks in a pane' })

    return next(e)
  })

  on('command.run', { command: 'epics' }, async $ => {
    await load($)
    await $.ui.open({ id: PANE, title: 'Epics' })

    return { text: 'Epics pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const all = await read($, epics)
    const isShowingDone = await read($, showDone)
    const open = all.filter(one => !isClosed(one))
    const closed = all.filter(isClosed)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold>Epics</Text>
          <Text dimColor>
            {open.length} open · {closed.length} closed
          </Text>
        </Box>
        <Box gap={2} marginTop={1}>
          <Button key="refresh" plain hotkey="r" label="Refresh" onPress={() => load($)} />
          <Button
            key="toggle-done"
            plain
            hotkey="d"
            label={isShowingDone ? 'Hide closed' : 'Show closed'}
            onPress={() => update($, showDone, value => !value)}
          />
        </Box>
        {all.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor italic>
              No .orchestration/ store in this folder.
            </Text>
          </Box>
        )}
        {open.map(epic => {
          const done = epic.issues.filter(one => one.status === 'Done').length

          return (
            <Box key={epic.slug} flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor="cyan">
              <Box justifyContent="space-between">
                <Text bold wrap="truncate-end">
                  {epic.title}
                </Text>
                <Text color="green">
                  {'■'.repeat(done)}
                  <Text dimColor>{'□'.repeat(epic.issues.length - done)}</Text> {done}/{epic.issues.length}
                </Text>
              </Box>
              {epic.issues.map(issue => (
                <Box key={`${epic.slug}-${issue.id}`} gap={1}>
                  <Text color={STATUS_COLOR[issue.status] ?? 'white'} bold>
                    {issue.status.padEnd(11)}
                  </Text>
                  <Text dimColor>w{issue.wave}</Text>
                  <Text wrap="truncate-end" strikethrough={issue.status === 'Canceled'}>
                    {issue.title || issue.id}
                  </Text>
                </Box>
              ))}
            </Box>
          )
        })}
        {isShowingDone &&
          closed.map(epic => (
            <Box key={epic.slug} gap={1} marginTop={1}>
              <Text color="green">✓</Text>
              <Text dimColor wrap="truncate-end">
                {epic.title} · {epic.issues.length} {epic.issues.length === 1 ? 'chunk' : 'chunks'}
              </Text>
            </Box>
          ))}
      </Box>
    )
  })
}
