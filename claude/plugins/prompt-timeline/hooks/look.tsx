import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { ReplyTag } from '../types'
import { describe } from './cards'

// The rest of the transcript's look: a model pill opening each reply, so replies read apart
// from your cyan prompt cards, and startup notices with an icon and their /command as a pill.

const INDENT = 2
// Columns a reply frame takes: border and one column of padding on each side, plus the right margin.
const FRAME = 5
let model = ''
let effort = ''
// The model and effort each reply was made with, by its id, so redrawing an old reply after a
// /model or effort change keeps what it was made with. Kept in session state across reloads.
const replyTags = atom({ plugin: 'prompt-timeline', key: 'replyTags' } as const, {} as Record<string, ReplyTag>)
// Each session's tags are also saved to the plugin's store (a JSON file on disk) under this
// key, so a quit-and-resume keeps them; the main module loads them at session start.
// debt: one key per session, never pruned; the store is capped at 4 MiB (~20k replies). Drop the oldest session keys if it fills.
export const storeKey = (sessionId: string) => `replies:${sessionId}`
// A reply is keyed by the start of its text: the id it is drawn under may not survive a resume.
export const replyKey = (text: string) => text.slice(0, 160)
let sessionId = ''
export const setSessionId = (id: string) => {
  sessionId = id
}

// One color per model family, so a switch is visible at a glance.
const FAMILY_COLOR: Record<string, string> = { opus: 'magenta', sonnet: 'blue', haiku: 'green', fable: 'yellow' }
export const familyColor = (label: string) => FAMILY_COLOR[label.split(' ')[0]?.toLowerCase() ?? ''] ?? 'gray'

// Set from the main module's session start; a mod cannot hand `$` across files.
export const setModel = (id: string) => {
  model = modelLabel(id)
}

// Splits markdown into runs of prose and of table rows (lines starting with `|`), leaving fenced
// code blocks whole.
export function splitTables(text: string) {
  const parts: { isTable: boolean; text: string }[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) inFence = !inFence
    const isTable = !inFence && line.trimStart().startsWith('|')
    const last = parts.at(-1)
    if (last && last.isTable === isTable) last.text += `\n${line}`
    else parts.push({ isTable, text: line })
  }

  return parts.filter(part => part.text.trim())
}

// The width a markdown table draws at: each column as wide as its widest cell, plus borders and
// one space of padding a side. Used to indent a table only when it still fits.
export function tableWidth(text: string) {
  const rows = text
    .split('\n')
    .filter(line => line.trim().startsWith('|') && !/^\s*\|[\s:|-]+\|\s*$/.test(line))
    .map(line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim().replace(/\*\*|`/g, '').length))
  const widths = rows.reduce<number[]>((max, row) => row.map((w, i) => Math.max(w, max[i] ?? 0)), [])

  return widths.reduce((sum, w) => sum + w + 3, 1)
}

// `claude-opus-5-5[1m]` reads as `Opus 5.5`; anything else is shown as given.
export function modelLabel(id: string) {
  const m = id.match(/claude-([a-z]+)-(\d+)-(\d+)/i)

  return m?.[1] ? `${m[1][0]!.toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id.replace(/\[.*\]$/, '')
}

export function registerLook(on: On) {
  // Each model request of the main loop names the model and effort the reply is made with.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      model = modelLabel(e.model)
      effort = e.effort === undefined ? '' : String(e.effort)
    }

    return yield* next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // Each block of a reply sits in a dim rounded frame, INDENT in, so its edges are visible; the
    // first block opens with the model pill inside the frame. A table too wide for the frame would
    // wrap its right side, so a block holding one is drawn unframed, the wide table at full width.
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const parts = splitTables(e.props.text)
    const room = (e.viewport?.columns ?? 0) - INDENT - FRAME
    const fits = parts.every(part => !part.isTable || tableWidth(part.text) <= room)
    let pill = null
    if (e.props.isFirstOfReply) {
      const key = replyKey(e.props.text)
      const saved = (await read($, replyTags))[key]
      const tag = saved ?? { model, effort }
      if (!tag.model) return next(e)
      if (!saved) {
        // Drawing cannot write state, so the tag is saved just after, in memory and on disk.
        $.clock.after(0, () => {
          void (async () => {
            await update($, replyTags, all => (all[key] ? all : { ...all, [key]: tag }))
            if (sessionId) await $.store.set(storeKey(sessionId), await read($, replyTags))
          })()
        })
      }
      const color = familyColor(tag.model)
      pill = (
        <Box gap={1} marginBottom={1}>
          <Text backgroundColor={color} color="black" bold>
            {` ◆ ${tag.model} `}
          </Text>
          {tag.effort && <Text color={color}>{`effort ${tag.effort}`}</Text>}
        </Box>
      )
    }

    if (fits) {
      return (
        <Box marginTop={1} marginLeft={INDENT} marginRight={1} flexDirection="column" borderStyle="round" borderColor="gray" borderDimColor paddingX={1}>
          {pill}
          {parts.map((part, i) => (
            <Markdown key={`part-${i}`} text={part.text} />
          ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" marginTop={1}>
        {pill && <Box paddingLeft={INDENT}>{pill}</Box>}
        {parts.map((part, i) =>
          part.isTable && tableWidth(part.text) > room ? (
            <Markdown key={`part-${i}`} text={part.text} />
          ) : (
            <Box key={`part-${i}`} paddingLeft={INDENT} paddingRight={1}>
              <Markdown text={part.text} />
            </Box>
          ),
        )}
      </Box>
    )
  })

  // Tool calls read as cards: status dot, a colored tool label, one readable title, and a dim
  // detail line, instead of the raw tool name and its whole input. See cards.ts per tool.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const card = describe(e.props.tool, (e.props.input ?? {}) as Record<string, unknown>)
    if (!card) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const state = e.props.isErrored ? 'red' : e.props.isInterrupted ? 'yellow' : e.props.isRunning ? 'gray' : 'green'

    return (
      <Box paddingLeft={INDENT} paddingRight={1} flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Text color={state}>●</Text>
          <Text backgroundColor={card.color} color={card.color === 'blackBright' ? 'white' : 'black'} bold>
            {` ${card.label} `}
          </Text>
          <Text bold wrap="truncate-end">
            {card.title}
          </Text>
          {e.props.isInterrupted && <Text color="yellow">interrupted</Text>}
        </Box>
        {card.detail && (
          <Text dimColor wrap="truncate-end">
            {`  ${card.detail}`}
          </Text>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'InfoNotice' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box marginX={1} gap={1}>
        <Text color="blue" bold>
          ℹ
        </Text>
        <Text>{e.props.text}</Text>
        {e.props.command && (
          <Text backgroundColor="blue" color="black">
            {` ${e.props.command} `}
          </Text>
        )}
      </Box>
    )
  })
}
