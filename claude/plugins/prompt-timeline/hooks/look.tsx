import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { ReplyTag } from '../types'
import { describe, pngIn } from './cards'

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
const enlarged = atom({ plugin: 'prompt-timeline', key: 'enlarged' } as const, null as { png: string; width: number; height: number } | null)
const SHOT_PANE = 'screenshot'
// A terminal cell is about twice as tall as it is wide.
const rowsFor = (shot: { width: number; height: number }, columns: number) => Math.min(60, Math.max(1, Math.round((columns * shot.height) / shot.width / 2)))
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

// A markdown table as cells: the header, then each row, separator line dropped.
export function parseTable(text: string) {
  const rows = text
    .split('\n')
    .filter(line => line.trim().startsWith('|') && !/^\s*\|[\s:|-]+\|\s*$/.test(line))
    .map(line => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim()))

  return { header: rows[0] ?? [], rows: rows.slice(1) }
}

// Column widths that fit `room`: each column keeps its natural width when all fit; otherwise
// narrow columns keep theirs and the rest share what is left, so long cells wrap instead.
export function fitColumns(natural: number[], room: number, gap: number) {
  const space = room - gap * (natural.length - 1)
  if (room <= 0 || natural.reduce((a, b) => a + b, 0) <= space) return natural
  const widths = natural.map(() => 0)
  let left = space
  let open = natural.map((_, i) => i)
  // Settle columns narrower than an equal share first, then split the rest evenly.
  for (;;) {
    const share = Math.floor(left / open.length)
    const small = open.filter(i => (natural[i] ?? 0) <= share)
    if (small.length === 0) {
      open.forEach((i, k) => (widths[i] = share + (k < left - share * open.length ? 1 : 0)))
      return widths.map(w => Math.max(4, w))
    }
    for (const i of small) {
      widths[i] = natural[i] ?? 0
      left -= widths[i] ?? 0
    }
    open = open.filter(i => !small.includes(i))
    if (open.length === 0) return widths
  }
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
    // first block opens with the model pill inside the frame.
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const parts = splitTables(e.props.text)
    const room = (e.viewport?.columns ?? 0) - INDENT - FRAME
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

    // Tables are drawn as columns fitted to the frame, since the markdown element draws a table
    // at its natural width whatever wraps it; long cells wrap inside their column.
    const GAP = 2
    const table = (text: string, i: number) => {
      const { header, rows } = parseTable(text)
      const plain = (cell: string) => cell.replace(/\*\*|`/g, '').length
      const widths = fitColumns(header.map((cell, c) => Math.max(plain(cell), ...rows.map(row => plain(row[c] ?? '')))), room, GAP)
      const line = <Text dimColor>{'─'.repeat(widths.reduce((a, b) => a + b, 0) + GAP * (widths.length - 1))}</Text>
      const row = (cells: string[], r: string, isHeader = false) => (
        <Box key={r} gap={GAP}>
          {widths.map((width, c) => (
            <Box key={`c${c}`} width={width}>
              <Markdown text={isHeader ? `**${cells[c] ?? ''}**` : (cells[c] ?? '')} />
            </Box>
          ))}
        </Box>
      )

      return (
        <Box key={`part-${i}`} flexDirection="column" marginY={1}>
          {row(header, 'h', true)}
          {line}
          {rows.map((cells, r) => (
            <Box key={`r${r}`} flexDirection="column">
              {row(cells, `row${r}`)}
              {r < rows.length - 1 && line}
            </Box>
          ))}
        </Box>
      )
    }

    return (
      <Box marginTop={1} marginLeft={INDENT} marginRight={1} flexDirection="column" borderStyle="round" borderColor="gray" borderDimColor paddingX={1}>
        {pill}
        {parts.map((part, i) => (part.isTable ? table(part.text, i) : <Markdown key={`part-${i}`} text={part.text} />))}
      </Box>
    )
  })

  // Tool calls read as cards: status dot, a colored tool label, one readable title, and a dim
  // detail line, instead of the raw tool name and its whole input. See cards.ts per tool.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const card = describe(e.props.tool, (e.props.input ?? {}) as Record<string, unknown>)
    if (!card) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // A grouped row gets its result here, not as its own ToolResult, so a returned PNG (a
    // browser screenshot) is drawn under the card. Only the terminal draws pictures.
    let picture = null
    const png = pngIn(e.props.output)
    if (png && e.surface === 'terminal') {
      const { Button, Image } = $.ui.resolve(e)
      const open = async () => {
        await update($, enlarged, () => png)
        await $.ui.open({ id: SHOT_PANE, title: 'Screenshot', focus: true, closeOnEscape: true, rows: rowsFor(png, 120) + 2, columns: 120 })
      }
      picture = (
        <Box flexDirection="column">
          <Image source={{ png: png.png }} columns={64} rows={Math.min(40, rowsFor(png, 64))} alt="Screenshot" />
          <Button key={`enlarge-${e.props.tool_use_id}`} plain label="⤢ Open large" onPress={open} />
        </Box>
      )
    }
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
          <Box paddingLeft={2}>
            <Text dimColor wrap="wrap">
              {card.detail}
            </Text>
          </Box>
        )}
        {picture && (
          <Box paddingLeft={2} marginTop={1}>
            {picture}
          </Box>
        )}
      </Box>
    )
  })

  // The enlarged screenshot fills the pane's width; Escape closes it.
  on('ui.render', { component: 'Pane', requestId: SHOT_PANE }, async ($, e, next) => {
    const shot = await read($, enlarged)
    if (!shot || e.surface !== 'terminal') return next(e)
    const { Box, Image } = $.ui.resolve(e)
    const columns = Math.max(20, e.props.bodyColumns - 2)

    return (
      <Box paddingX={1}>
        <Image source={{ png: shot.png }} columns={columns} rows={rowsFor(shot, columns)} alt="Screenshot" />
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
