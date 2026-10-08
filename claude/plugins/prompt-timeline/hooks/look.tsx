import { atom, read, update } from 'claude-code'
import type { BoxProps, CodeProps, ElementConstructor, On, RenderChildren, TextProps } from 'claude-code'

import type { ReplyTag } from '../types'
import { describe, pngIn, resultLine } from './cards'
import { OUTPUT_BAR, PANEL } from './theme'

// The rest of the transcript's look, after OpenCode's: replies as plain text with the model and
// effort in a footer line where the turn ends, tool calls as one light line each, and output in
// filled panels; startup notices with an icon and their /command as a pill.

const INDENT = 3
// Columns a reply frame takes: border and one column of padding on each side, plus the right margin.
const FRAME = 2
let model = ''
let effort = ''
// The model and effort each reply was made with, by its id, so redrawing an old reply after a
// /model or effort change keeps what it was made with. Kept in session state across reloads.
const replyTags = atom({ plugin: 'prompt-timeline', key: 'replyTags' } as const, {} as Record<string, ReplyTag>)
const enlarged = atom({ plugin: 'prompt-timeline', key: 'enlarged' } as const, null as { png: string; width: number; height: number } | null)
const SHOT_PANE = 'screenshot'
// Each Bash call's command and, for calls made since the module loaded, how long it ran, by id:
// the result row has neither.
const runs = new Map<string, { command: string; ms?: number }>()
// An inline script shows this many lines before it folds.
const SCRIPT_LINES = 20
// A call's text body (a PR comment, a query) shows this many lines before it folds.
const BODY_LINES = 8
// Bash output shows this many lines before it folds.
const OUTPUT_LINES = 12
// A file a Bash command changed shows this many diff lines before it folds.
const DIFF_LINES = 20
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

// The width the markdown element draws a table at: each column as wide as its widest cell, plus
// one space a side and a border per column.
export function tableWidth(text: string) {
  const { header, rows } = parseTable(text)
  const widths = header.map((cell, c) => Math.max(plainCell(cell).length, ...rows.map(row => plainCell(row[c] ?? '').length)))

  return widths.reduce((sum, w) => sum + w + 3, 1)
}

// A cell's text as shown: markdown bold and code markers dropped.
export const plainCell = (cell: string) => cell.replace(/\*\*|`/g, '')

// How many lines `text` takes when word-wrapped at `width`, as the terminal wraps it.
export function wrappedLines(text: string, width: number) {
  let lines = 1
  let used = 0
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const length = word.length
    if (used === 0) used = length
    else if (used + 1 + length <= width) used += 1 + length
    else {
      lines += 1
      used = length
    }
    while (used > width) {
      lines += 1
      used -= width
    }
  }

  return lines
}

// `claude-opus-5-5[1m]` reads as `Opus 5.5`; anything else is shown as given.
export function modelLabel(id: string) {
  const m = id.match(/claude-([a-z]+)-(\d+)-(\d+)/i)

  return m?.[1] ? `${m[1][0]!.toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id.replace(/\[.*\]$/, '')
}

type Hunk = { oldStart: number; newStart: number; lines: string[] }
type BashOutput = {
  stdout?: string
  stderr?: string
  interrupted?: boolean
  bashEditDiff?: { files?: { filePath: string; hunks: Hunk[] }[] }
  backgroundTaskId?: string
  timedOutAfterMs?: number
  isImage?: boolean
}
// Results that carry something this view does not draw (a background task id, a timeout, an
// image) keep Claude Code's own row, so nothing it shows goes missing.
const isPlainBash = (output: BashOutput) => !output.backgroundTaskId && !output.timedOutAfterMs && !output.isImage && !output.interrupted
type Ui = { Box: ElementConstructor<BoxProps>; Code: ElementConstructor<CodeProps>; Text: ElementConstructor<TextProps> }

// Bash output: dim, ANSI stripped, folded after OUTPUT_LINES, stderr in red, then each file the
// command changed as a framed diff (Claude Code attaches those to the result as bashEditDiff).
// rtk adds a "[see remaining: tail …]" pointer to its own log; it is not the command's output.
// Lines that report an outcome: test summaries, check marks, errors.
const PASSED = /^\s*(?:✔|✓|ok\b|PASS\b)|\b0 fail(?:ed|ures?)?\b|\b\d+ pass(?:ed|ing)?\b/i
const FAILED = /^\s*(?:✘|✗|×|FAIL\b)|\b[1-9]\d* fail(?:ed|ures?)?\b|\berror\b/i

const INTERPRETERS: [RegExp, string][] = [
  [/\bpython3?\b/, 'python'],
  [/\b(?:bun|tsx|ts-node)\b/, 'typescript'],
  [/\b(?:node|deno)\b/, 'javascript'],
  [/\bruby\b/, 'ruby'],
  [/\b(?:bash|sh|zsh)\b/, 'bash'],
]

// The script a command runs inline: a heredoc fed to an interpreter or written by cat, or an
// interpreter's -e/-c string. Null for any other command.
export function scriptOf(command: string): { source: string; language?: string; path?: string } | null {
  const heredoc = command.match(/^([^\n]*?)<<-?\s*(['"]?)(\w+)\2[^\n]*\n([\s\S]*?)\n\s*\3(?:\n|$)/m)
  const inline = command.match(/\b(node|bun|deno|python3?|ruby)\s+(?:-e|-c|--eval|-p)\s+(['"])([\s\S]+)\2\s*$/)
  const [head, source] = heredoc ? [heredoc[1] ?? '', heredoc[4] ?? ''] : inline ? [inline[1] ?? '', inline[3] ?? ''] : ['', '']
  if (!source.trim()) return null
  const written = head.match(/\bcat\s*>>?\s*(['"]?)([^\s'"]+)\1/)?.[2]
  if (written) return { source, path: written }
  const language = INTERPRETERS.find(([re]) => re.test(head.split(/&&|;|\|/).pop() ?? ''))?.[1]
  return language ? { source, language } : null
}

const duration = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

// After OpenCode's run view: the script numbered and highlighted, then its output.
function scriptSection({ Box, Code, Text }: Ui, script: NonNullable<ReturnType<typeof scriptOf>>, ms: number | undefined) {
  const lines = script.source.split('\n')
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between">
        <Text dimColor>Code</Text>
        {ms !== undefined && <Text dimColor>{`Completed · ${duration(ms)}`}</Text>}
      </Box>
      <Code source={lines.slice(0, SCRIPT_LINES).join('\n').slice(0, 10000)} language={script.language} path={script.path} startLine={1} />
      {lines.length > SCRIPT_LINES && <Text dimColor>{`… ${lines.length - SCRIPT_LINES} more lines`}</Text>}
    </Box>
  )
}

export function bashOutput({ Box, Code, Text }: Ui, output: BashOutput, withStdout = true, run?: { command: string; ms?: number }) {
  const clean = (text: string | undefined) =>
    (text ?? '')
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/^\[see remaining: .*\]$/gm, '')
      .replace(/\s+$/, '')
  const stdout = clean(output.stdout)
  const stderr = clean(output.stderr)
  const diffs = output.bashEditDiff?.files ?? []
  const lines = stdout && withStdout ? stdout.split('\n') : []
  const hidden = lines.length - OUTPUT_LINES
  // Printed diffs (git diff, diff -u): the lines from the first hunk on go to the highlighter.
  const hunk = lines.slice(0, OUTPUT_LINES).findIndex(line => /^@@ -\d/.test(line))
  const diffPath = stdout.match(/^\+\+\+ (?:b\/)?(\S+)/m)?.[1]
  const script = withStdout && run ? scriptOf(run.command) : null
  const isJson = /^[[{]/.test(stdout) && hidden <= 0 && (() => { try { JSON.parse(stdout); return true } catch { return false } })()

  // Full width, so diff lines wrap at the window's edge and not at their frame's own width.
  return (
    <Box flexDirection="column" width="100%">
      {withStdout && !script && lines.length === 0 && !stderr && diffs.length === 0 && <Text dimColor>(no output)</Text>}
      {(lines.length > 0 || script) && (
        <Box width="100%" backgroundColor={PANEL} marginTop={1}>
          <Box width={1} backgroundColor={OUTPUT_BAR} />
          <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
          {script && scriptSection({ Box, Code, Text }, script, run?.ms)}
          {script && <Text dimColor>Output</Text>}
          {script && lines.length === 0 && <Text dimColor>(no output)</Text>}
          {isJson && <Code source={stdout.slice(0, 10000)} language="json" startLine={1} />}
          {!isJson && lines.slice(0, hunk < 0 ? OUTPUT_LINES : hunk).map((line, i) => {
            // `path:12:code` (rg, grep) gets a dim gutter and the code coloured by its file type.
            const hit = line.match(/^([^\s:]+\.[\w]+):(\d+)[:-](.*)$/)
            if (hit?.[1] && hit[2]) {
              return (
                <Box key={`o${i}`} gap={1}>
                  <Text dimColor>{`${hit[1]}:${hit[2]}`}</Text>
                  {hit[3]?.trim() ? <Code source={hit[3]} path={hit[1]} /> : null}
                </Box>
              )
            }
            // `138:code` (rg -n on one file): the number in the gutter, the code as written.
            const numbered = line.match(/^(\d+)[:-](.*)$/)
            if (numbered?.[1]) {
              return (
                <Box key={`o${i}`} gap={1}>
                  <Text dimColor>{numbered[1].padStart(4)}</Text>
                  <Text wrap="truncate-end">{numbered[2] || ' '}</Text>
                </Box>
              )
            }
            const color = FAILED.test(line) ? 'red' : PASSED.test(line) ? 'green' : undefined
            return (
              <Text key={`o${i}`} color={color} dimColor={!color} wrap="truncate-end">
                {line || ' '}
              </Text>
            )
          })}
          {!isJson && hunk >= 0 && <Code source={lines.slice(hunk, OUTPUT_LINES).join('\n')} path={diffPath} format="diff" />}
          {hidden > 0 && <Text dimColor>{`… ${hidden} more lines`}</Text>}
          </Box>
        </Box>
      )}
      {withStdout && stderr && (
        <Text color="red" wrap="wrap">
          {stderr.split('\n').slice(0, OUTPUT_LINES).join('\n')}
        </Text>
      )}
      {diffs.map((file, f) => {
        // Claude Code's own highlighter draws the hunks: syntax colours from the path, gutters,
        // and add/remove shading. Hunks past DIFF_LINES lines are left out and counted.
        let budget = DIFF_LINES
        const kept: Hunk[] = []
        for (const hunk of file.hunks) {
          if (budget <= 0) break
          kept.push({ ...hunk, lines: hunk.lines.slice(0, budget) })
          budget -= hunk.lines.length
        }
        const total = file.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
        const shown = kept.reduce((sum, hunk) => sum + hunk.lines.length, 0)
        const count = (hunk: Hunk, mark: string) => hunk.lines.filter(line => line[0] === mark || line[0] === ' ').length
        const source = kept
          .map(hunk => [`@@ -${hunk.oldStart},${count(hunk, '-')} +${hunk.newStart},${count(hunk, '+')} @@`, ...hunk.lines].join('\n'))
          .join('\n')
          .slice(0, 10000)
        const all = file.hunks.flatMap(hunk => hunk.lines)
        const path = file.filePath.replace(/^\/Users\/[^/]+/, '~')
        const cut = path.lastIndexOf('/') + 1
        return (
          <Box key={`d${f}`} width="100%" marginTop={1} backgroundColor={PANEL}>
            <Box width={1} backgroundColor={OUTPUT_BAR} />
            <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
            <Box gap={1}>
              <Text color="yellow">✎</Text>
              <Text bold>{path.slice(cut)}</Text>
              <Text dimColor>{path.slice(0, cut)}</Text>
              <Text backgroundColor="green" color="black">{` +${all.filter(line => line[0] === '+').length} `}</Text>
              <Text backgroundColor="red" color="black">{` −${all.filter(line => line[0] === '-').length} `}</Text>
            </Box>
            {source && <Code source={source} path={file.filePath} format="diff" />}
            {total > shown && <Text dimColor>{`… ${total - shown} more lines`}</Text>}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

// Calls Claude Code folded into a group: when the group is expanded each draws its own row, and
// Claude Code draws that row's result inline rather than as a separate ToolResult row.
const grouped = new Set<string>()
// The tag of the reply drawn last: the turn's footer, drawn after its replies, names it.
let lastTag: ReplyTag | null = null

export function registerLook(on: On) {
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    for (const call of e.props.calls) if (call.tool_use_id) grouped.add(call.tool_use_id)

    return next(e)
  })

  // Each model request of the main loop names the model and effort the reply is made with.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      model = modelLabel(e.model)
      effort = e.effort === undefined ? '' : String(e.effort)
    }

    return yield* next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // Plain text behind a thin bar in the model's colour, so a reply reads apart from Claude
    // Code's own rows (stop hooks, notices) at the same indent; the model and effort that made
    // it go in the footer where the turn ends (TurnDuration, below).
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const parts = splitTables(e.props.text)
    const room = (e.viewport?.columns ?? 0) - INDENT - FRAME
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
      lastTag = tag
    }

    // A table too wide for the reply is drawn as a grid fitted to the window: the markdown element
    // draws a table at its natural width whatever wraps it. Cells are plain text with their bold and code spans kept,
    // so each row's height is known and the column dividers line up when a cell wraps.
    const table = (text: string, i: number) => {
      const { header, rows } = parseTable(text)
      const natural = header.map((cell, c) => Math.max(plainCell(cell).length, ...rows.map(row => plainCell(row[c] ?? '').length)))
      // Each column costs its width, one space a side, and a divider.
      const widths = fitColumns(natural, room - 1 - 3 * natural.length, 3)
      const rule = (left: string, mid: string, right: string) => (
        <Text dimColor>{left + widths.map(w => '─'.repeat(w + 2)).join(mid) + right}</Text>
      )
      const cellText = (cell: string, isHeader: boolean) =>
        cell.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((piece, k) =>
          piece.startsWith('`') ? (
            <Text key={`s${k}`} color="cyan">{piece.slice(1, -1)}</Text>
          ) : piece.startsWith('**') ? (
            <Text key={`s${k}`} bold>{piece.slice(2, -2)}</Text>
          ) : (
            <Text key={`s${k}`} bold={isHeader}>{piece}</Text>
          ),
        )
      const row = (cells: string[], r: string, isHeader = false) => {
        const height = Math.max(1, ...widths.map((w, c) => wrappedLines(plainCell(cells[c] ?? ''), w)))
        const bar = <Text dimColor>{Array.from({ length: height }, () => '│').join('\n')}</Text>
        return (
          <Box key={r}>
            {bar}
            {widths.map((width, c) => (
              <Box key={`c${c}`}>
                <Box width={width + 2} paddingX={1} backgroundColor={isHeader ? PANEL : undefined}>
                  <Text wrap="wrap">{cellText(cells[c] ?? '', isHeader)}</Text>
                </Box>
                {bar}
              </Box>
            ))}
          </Box>
        )
      }

      return (
        <Box key={`part-${i}`} flexDirection="column" marginY={1}>
          {rule('╭', '┬', '╮')}
          {row(header, 'h', true)}
          {rule('├', '┼', '┤')}
          {rows.map((cells, r) => (
            <Box key={`r${r}`} flexDirection="column">
              {row(cells, `row${r}`)}
              {r < rows.length - 1 && rule('├', '┼', '┤')}
            </Box>
          ))}
          {rule('╰', '┴', '╯')}
        </Box>
      )
    }

    return (
      <Box marginTop={1} marginRight={2}>
        <Box width={1} backgroundColor={familyColor((lastTag ?? { model }).model || '')} />
        <Box paddingLeft={INDENT - 1} paddingY={1} flexDirection="column" flexGrow={1}>
        {parts.map((part, i) =>
          // Claude Code's own table when it fits; the fitted grid only when the table is wider than
          // the reply, where the markdown element would run past the edge and wrap its border.
          part.isTable && tableWidth(part.text) > room ? table(part.text, i) : <Markdown key={`part-${i}`} text={part.text} />,
        )}
        </Box>
      </Box>
    )
  })

  // The turn's closing line, as OpenCode draws it: model, effort and time, the model in its
  // family colour.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!lastTag) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const seconds = Math.round(e.props.durationMs / 1000)
    const time = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`

    return (
      <Box paddingLeft={INDENT} marginY={1}>
        <Text color={familyColor(lastTag.model)}>◆ {lastTag.model}</Text>
        <Text dimColor>{`${lastTag.effort ? ` · ${lastTag.effort}` : ''} · ${time}`}</Text>
      </Box>
    )
  })

  // Tool calls read as cards: status dot, a colored tool label, one readable title, and a dim
  // detail line, instead of the raw tool name and its whole input. See cards.ts per tool.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const start = Date.now()
    const result = await next(e)
    runs.set(e.tool_use_id, { command: e.command, ms: Date.now() - start })
    return result
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const command = (e.props.input as { command?: unknown } | undefined)?.command
    if (e.props.tool === 'Bash' && typeof command === 'string' && !runs.has(e.props.tool_use_id)) runs.set(e.props.tool_use_id, { command })
    const card = describe(e.props.tool, (e.props.input ?? {}) as Record<string, unknown>)
    if (!card) return next(e)
    const { Box, Code, Markdown, Text } = $.ui.resolve(e)
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
    const result = resultLine(e.props.tool, e.props.output)

    return (
      <Box paddingLeft={INDENT} paddingRight={1} flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Text color={state}>→</Text>
          <Text color={card.color === 'blackBright' ? 'gray' : card.color} bold>
            {card.label}
          </Text>
          <Text wrap="truncate-end">{card.title}</Text>
          {e.props.isInterrupted && <Text color="yellow">interrupted</Text>}
        </Box>
        {card.detail && (
          <Box paddingLeft={2}>
            <Text dimColor wrap="wrap">
              {card.detail}
            </Text>
          </Box>
        )}
        {card.body && (
          <Box paddingLeft={2} marginTop={1} flexDirection="column">
            <Markdown text={card.body.split('\n').slice(0, BODY_LINES).join('\n')} />
            {card.body.split('\n').length > BODY_LINES && <Text dimColor>{`… ${card.body.split('\n').length - BODY_LINES} more lines`}</Text>}
          </Box>
        )}
        {picture && (
          <Box paddingLeft={2} marginTop={1}>
            {picture}
          </Box>
        )}
        {grouped.has(e.props.tool_use_id) && e.props.output !== undefined && !picture && (
          <Box paddingLeft={2}>
            {e.props.tool === 'Bash' ? (
              bashOutput({ Box, Code, Text }, e.props.output as BashOutput, true, runs.get(e.props.tool_use_id))
            ) : result ? (
              <Box flexDirection="column">
                {result
                  .split('\n')
                  .map((line, i) => (
                    <Text key={i} dimColor wrap="truncate-end">{`${i === 0 ? '↳' : ' '} ${line}`}</Text>
                  ))}
              </Box>
            ) : null}
          </Box>
        )}
      </Box>
    )
  })

  // Bash output sits under its card; see bashOutput. repo-docs draws its own reindex summary,
  // and anything Claude Code adds that this does not draw keeps Claude Code's own row.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== 'Bash' || e.props.isErrored) return next(e)
    const output = (e.props.output ?? {}) as BashOutput
    if (/repo_docs_index updated=/.test(output.stdout ?? '') || !isPlainBash(output)) return next(e)
    const { Box, Code, Text } = $.ui.resolve(e)
    const pad = (tree: RenderChildren) => <Box paddingLeft={INDENT + 2} paddingRight={1} width="100%">{tree}</Box>
    const run = runs.get(e.props.tool_use_id)
    // There is no expanded flag here, so output that would fold goes to Claude Code's own row,
    // which details and ctrl+o unfold. A script and the files the command changed stay drawn here.
    if ((output.stdout ?? '').replace(/^\[see remaining: .*\]$/gm, '').trimEnd().split('\n').length > OUTPUT_LINES) {
      const own = await next({ ...e, props: { ...e.props, output: { ...output, bashEditDiff: undefined } } })
      const script = scriptOf(run?.command ?? '')
      if (!output.bashEditDiff?.files?.length && !script) return own
      return (
        <Box flexDirection="column" width="100%">
          {script &&
            pad(
              <Box width="100%" backgroundColor={PANEL} marginTop={1}>
                <Box width={1} backgroundColor={OUTPUT_BAR} />
                <Box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={1}>
                  {scriptSection({ Box, Code, Text }, script, run?.ms)}
                </Box>
              </Box>,
            )}
          {own}
          {output.bashEditDiff?.files?.length ? pad(bashOutput({ Box, Code, Text }, output, false)) : null}
        </Box>
      )
    }

    return pad(bashOutput({ Box, Code, Text }, output, true, run))
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
