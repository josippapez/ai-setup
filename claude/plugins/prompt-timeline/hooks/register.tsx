import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Prompt } from '../types'
import type { ReplyTag } from '../types'
import { registerLook, setModel, setSessionId, storeKey } from './look'

const PANE = 'timeline'
const STRIP = 6
// Kept in session state, so the list survives /reload-plugins.
const prompts = atom({ plugin: 'prompt-timeline', key: 'prompts' } as const, [] as Prompt[])

const textOf = (content: readonly { type: string }[]) =>
  content.map(block => ('text' in block && block.type === 'text' ? String(block.text) : '')).join('\n')
// The same session value look.tsx draws from; the scanner wants each module to name its own.
const replyTags = atom({ plugin: 'prompt-timeline', key: 'replyTags' } as const, {} as Record<string, ReplyTag>)

const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''

export const register: Register = on => {
  registerLook(on)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'timeline', description: 'List your prompts in this session and jump to one' })
    setModel(await $.session.model())
    // Prompts sent before the plugin loaded are only in the transcript file.
    const sessionId = await $.session.id()
    setSessionId(sessionId)
    const savedTags = ((await $.store.get(storeKey(sessionId))) ?? {}) as Record<string, ReplyTag>
    await update($, replyTags, all => ({ ...savedTags, ...all }))
    const ran = await $.process.run(['node', `${$.plugin.root}/scripts/prompts.cjs`, sessionId])
    const earlier: Prompt[] = ran.exitCode === 0 ? JSON.parse(ran.stdout) : []
    await update($, prompts, seen => {
      // Keep an id a card already saved for the same prompt, so a reload does not duplicate it.
      const left = [...seen]
      const merged = earlier.map(one => {
        const at = left.findIndex(mine => mine.id === one.id || (mine.isDrawn && mine.text === one.text))
        return at < 0 ? one : left.splice(at, 1)[0]!
      })
      return [...merged, ...left]
    })

    return next(e)
  })

  on('command.run', { command: 'timeline' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Timeline' })

    return { text: 'Timeline pane opened.' }
  })

  // Record each prompt as it is stored; its row id is the id the transcript draws it under.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (stored.deny === undefined && e.door === 'prompt' && e.agentId === undefined) {
      const text = textOf(e.message.content)
      if (text.trim()) await update($, prompts, all => [...all, { id: stored.uuid, text }])
    }

    return stored
  })

  // Your own prompts get a card of their own, numbered as in the timeline.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const list = await read($, prompts)
    const text = e.props.text.trim()
    // The row is drawn under an id of its own, not the saved row's, so match on the text and
    // remember the drawn id: that is what the strip and timeline scroll to. Drawing cannot
    // write state, so the id is saved just after.
    let index = list.findIndex(one => one.id === e.requestId)
    if (index < 0) index = list.findIndex(one => one.text.trim() === text && !one.isDrawn)
    const match = list[index]
    if (match && match.id !== e.requestId) {
      const drawnId = e.requestId
      $.clock.after(0, () => {
        void update($, prompts, all => all.map(one => (one === match || one.id === match.id ? { ...one, id: drawnId, isDrawn: true } : one)))
      })
    }
    // Slash commands are saved as commands, not prompts, so they never join the list; they keep the default row.
    if ((index < 0 && e.props.origin.kind !== 'composer') || !text || text.startsWith('/')) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    // Every saved prompt is in the list (recorded on save, or read back from the transcript),
    // so a prompt row that is not there yet is still waiting in the queue.
    if (index < 0) {
      return (
        <Box marginX={1} flexDirection="column" borderStyle="single" borderColor="gray" borderDimColor paddingX={1}>
          <Text dimColor italic>
            ◌ Queued · sends when the current turn ends
          </Text>
          <Text dimColor wrap="wrap">
            {e.props.text}
          </Text>
        </Box>
      )
    }

    return (
      <Box marginX={1} flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan" bold>
          › You · #{index + 1}
        </Text>
        <Text wrap="wrap">{e.props.text}</Text>
      </Box>
    )
  })

  // Panes share one dock as tabs, so the always-visible strip lives above the prompt instead.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, prompts)
    if (list.length === 0 || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const rest = await next(e)
    const recent = list.slice(-STRIP)
    // Leave room for the icon and `▸ /timeline`, so the row stays one line.
    const label = Math.max(10, Math.floor((e.props.bodyColumns - 18) / recent.length) - 8)

    return (
      <Box flexDirection="column">
        {rest}
        <Text color="cyan" dimColor>
          {'─'.repeat(Math.max(10, e.props.bodyColumns))}
        </Text>
        <Box justifyContent="space-between">
        <Box gap={1} flexShrink={1} overflow="hidden">
          <Text color="cyan" bold>
            ⏱
          </Text>
          {recent.map((one, i) => {
            const number = list.length - recent.length + i + 1
            const line = firstLine(one.text)
            const isLatest = i === recent.length - 1
            return (
              <Box key={`chip-${number}`} backgroundColor={isLatest ? 'cyan' : 'blackBright'} paddingX={1}>
                <Button
                  key={`strip-${number}`}
                  plain
                  label={`#${number} ${line.length > label ? `${line.slice(0, label - 1)}…` : line}`}
                  onPress={() => $.ui.scroll({ to: { requestId: one.id }, block: 'start' })}
                />
              </Box>
            )
          })}
        </Box>
          <Text dimColor>▸ /timeline</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, prompts)
    const width = Math.max(20, e.props.bodyColumns - 10)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold>Your prompts</Text>
          <Text dimColor>{list.length} this session</Text>
        </Box>
        {list.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor italic>
              Prompts show up here as they're drawn in the transcript.
            </Text>
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          {list.map((one, i) => (
            <Box key={one.id} gap={1}>
              <Text color="cyan">{String(i + 1).padStart(3)}</Text>
              <Button
                key={`jump-${i + 1}`}
                plain
                label={firstLine(one.text).slice(0, width) || '(empty)'}
                onPress={() => $.ui.scroll({ to: { requestId: one.id }, block: 'start' })}
              />
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
