import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { FileEdit } from '../types'

// Replay: every Edit and Write of a turn, kept as the file before and after, so the last turn's
// changes can be stepped through side by side in a pane once it ends.

const PANE = 'replay'
const CONTEXT = 3
const replay = atom({ plugin: 'prompt-timeline', key: 'replay' } as const, { edits: [] as FileEdit[], at: 0, isNew: false })

// The turn's edits so far; moved into the atom when the turn ends.
let recording: FileEdit[] = []

// The changed block between two versions: common lines are trimmed from both ends, leaving one
// region with CONTEXT lines either side. Edit changes one region, which this shows exactly.
export function changedBlock(before: string, after: string) {
  const a = before.split('\n')
  const b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1
  const from = Math.max(0, start - CONTEXT)

  return {
    from,
    head: a.slice(from, start),
    removed: a.slice(start, a.length - end),
    added: b.slice(start, b.length - end),
    tail: a.slice(a.length - end, Math.min(a.length, a.length - end + CONTEXT)),
  }
}

export function registerReplay(on: On) {
  // Two hooks, not a loop: a matcher's tool has to be a literal for the input to be typed.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const before = (await $.fs.exists(e.file_path)) ? await $.fs.read(e.file_path) : ''
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) recording.push({ tool: 'Edit', file: e.file_path, before, after: await $.fs.read(e.file_path) })

    return ran
  })
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const before = (await $.fs.exists(e.file_path)) ? await $.fs.read(e.file_path) : ''
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) recording.push({ tool: 'Write', file: e.file_path, before, after: await $.fs.read(e.file_path) })

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && recording.length > 0) {
      const edits = recording
      recording = []
      await update($, replay, () => ({ edits, at: 0, isNew: true }))
    }

    return done
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, replay, state => ({ ...state, isNew: false }))

    return next(e)
  })

  on('command.run', { command: 'replay' }, async $ => {
    if ((await read($, replay)).edits.length === 0) return { text: 'No edits recorded yet.' }
    await update($, replay, state => ({ ...state, isNew: false }))
    await $.ui.open({ id: PANE, title: 'Replay', focus: true, closeOnEscape: true })

    return { text: 'Replay opened.' }
  })

  // A one-line hint above the prompt after a turn that edited files.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, replay)
    const rest = await next(e)
    if (!state.isNew || e.props.hasSurvey) return rest
    const { Box, Text } = $.ui.resolve(e)
    const files = new Set(state.edits.map(edit => edit.file)).size

    return (
      <Box flexDirection="column">
        <Box paddingX={1} gap={1}>
          <Text color="magenta">✎</Text>
          <Text dimColor>
            {state.edits.length} edit{state.edits.length === 1 ? '' : 's'} in {files} file{files === 1 ? '' : 's'} last turn · /replay to step through
          </Text>
        </Box>
        {rest}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { edits, at } = await read($, replay)
    const edit = edits[at]
    if (!edit) return <Text dimColor>No edits recorded yet.</Text>
    const block = changedBlock(edit.before, edit.after)
    const side = Math.max(10, Math.floor((e.props.bodyColumns - 3) / 2))
    const width = String(block.from + Math.max(block.head.length + block.removed.length, block.head.length + block.added.length) + block.tail.length).length
    const cell = (n: number | null, line: string | undefined, color?: string) => (
      <Box width={side}>
        <Text color={color} dimColor={color === undefined} wrap="truncate-end">
          {line === undefined ? '' : `${String(n).padStart(width)} ${line}`}
        </Text>
      </Box>
    )
    const rows = Math.max(block.removed.length, block.added.length)
    const go = (step: number) => update($, replay, state => ({ ...state, at: (state.at + step + state.edits.length) % state.edits.length }))

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold wrap="truncate-end">
            {edit.tool} {edit.file.split('/').slice(-2).join('/')}
          </Text>
          <Box gap={2}>
            <Button key="replay-prev" plain hotkey="p" label="◀ Prev" onPress={() => go(-1)} />
            <Text dimColor>
              {at + 1}/{edits.length}
            </Text>
            <Button key="replay-next" plain hotkey="n" label="Next ▶" onPress={() => go(1)} />
          </Box>
        </Box>
        <Box gap={1} marginTop={1}>
          <Box width={side}>
            <Text color="red" bold>
              Before
            </Text>
          </Box>
          <Text dimColor>│</Text>
          <Box width={side}>
            <Text color="green" bold>
              After
            </Text>
          </Box>
        </Box>
        {block.head.map((line, i) => (
          <Box key={`h${i}`} gap={1}>
            {cell(block.from + i + 1, line)}
            <Text dimColor>│</Text>
            {cell(block.from + i + 1, line)}
          </Box>
        ))}
        {Array.from({ length: rows }, (_, i) => {
          const n = block.from + block.head.length + i + 1
          return (
            <Box key={`c${i}`} gap={1}>
              {cell(n, block.removed[i], 'red')}
              <Text dimColor>│</Text>
              {cell(n, block.added[i], 'green')}
            </Box>
          )
        })}
        {block.tail.map((line, i) => (
          <Box key={`t${i}`} gap={1}>
            {cell(block.from + block.head.length + block.removed.length + i + 1, line)}
            <Text dimColor>│</Text>
            {cell(block.from + block.head.length + block.added.length + i + 1, line)}
          </Box>
        ))}
      </Box>
    )
  })
}
