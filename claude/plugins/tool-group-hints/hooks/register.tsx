import type { Register, ToolGroupCall } from 'claude-code'

const MAX_HINTS = 6
// Lines of content shown under the hints, shared by the group's calls.
const PREVIEW_LINES = 10

export function labelFor(tool: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)

  if (!mcp) {
    return tool
  }

  // Plugin servers are named plugin_<plugin>_<server>.
  const server = /^plugin_[^_]+_(.+)$/.exec(mcp[1]!)?.[1] ?? mcp[1]

  return `${server} › ${mcp[2]}`
}

// Arguments that are the same on nearly every call of a server (chrome-devtools'
// pageId, ado's project) and would push the useful ones off the line.
const NOISE = new Set(['pageId', 'project', 'repositoryId', 'device', 'format'])

function argValue(v: unknown): string | undefined {
  if (Array.isArray(v)) {
    const first = typeof v[0] === 'string' ? v[0] : undefined
    return v.length === 0 ? undefined : first !== undefined && v.length === 1 ? first : `[${v.length}]`
  }

  return ['string', 'number', 'boolean'].includes(typeof v) && String(v).length > 0 ? String(v).split('\n')[0] : undefined
}

// Any other tool, MCP ones included: an `action` bare, then its first few short arguments.
function argsSummary(input: Record<string, unknown>): string {
  const action = typeof input.action === 'string' ? [input.action] : []
  const args = Object.entries(input)
    .filter(([k]) => k !== 'action' && !NOISE.has(k))
    .flatMap(([k, v]) => {
      const value = argValue(v)

      return value === undefined ? [] : [`${k}=${value}`]
    })

  return [...action, ...args].slice(0, 3).join(' ')
}

// A row is a run of styled parts: the verb, the thing acted on, and quieter connectors.
export type Part = { text: string; kind: 'verb' | 'path' | 'range' | 'pattern' | 'plain' | 'dim' }

// The verb's color follows prompt-timeline's tool cards: reads blue, searches cyan.
const VERB_COLOR: Record<string, string> = { Read: 'blue', Search: 'cyan', List: 'cyan', Fetch: 'cyan', Ran: 'magenta', Running: 'magenta', Skill: 'magenta', LSP: 'yellow', Load: 'gray' }

const verb = (text: string): Part => ({ text, kind: 'verb' })
const dim = (text: string): Part => ({ text, kind: 'dim' })
const plain = (text: string): Part => ({ text, kind: 'plain' })

// Partial reads name their line range (`a.ts:120-180`), as Pi does.
function readParts(call: ToolGroupCall): Part[] {
  const path = String((call.input as { file_path?: unknown } | undefined)?.file_path ?? '')
  const file = (call.output as { file?: { startLine?: unknown; numLines?: unknown; totalLines?: unknown } } | undefined)?.file
  const start = Number(file?.startLine)
  const shown = Number(file?.numLines)
  const isPartial = file && shown !== Number(file.totalLines) && start > 0 && shown > 0

  return [{ text: path, kind: 'path' }, ...(isPartial ? [{ text: `:${start}-${start + shown - 1}`, kind: 'range' } as Part] : [])]
}

// One row per call, led by a verb as in Codex's Explored block: `Read a.ts`, `Search "foo" in src`, `Ran git status`.
export function hintParts(call: ToolGroupCall): Part[] {
  const input = (call.input ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const where = (k: string): Part[] => (str(k) ? [dim(' in '), { text: str(k), kind: 'path' }] : [])

  switch (call.tool) {
    case 'Bash':
      return [verb(call.isRunning ? 'Running' : 'Ran'), plain(` ${str('command').replace(/^\s*cd \S+\s*(&&|;)\s*/, '').split('\n')[0]}`)]
    case 'Grep':
      return [verb('Search'), plain(' '), { text: `"${str('pattern')}"`, kind: 'pattern' }, ...where('path'), ...(str('glob') ? [dim(` (${str('glob')})`)] : [])]
    case 'Glob':
      return [verb('List'), plain(' '), { text: str('pattern'), kind: 'pattern' }, ...where('path')]
    case 'Read':
      return [verb('Read'), plain(' '), ...readParts(call)]
    case 'WebFetch':
      return [verb('Fetch'), plain(` ${str('url')}`)]
    case 'WebSearch':
      return [verb('Search'), dim(' web '), { text: `"${str('query')}"`, kind: 'pattern' }]
    case 'ToolSearch':
      return [verb('Load'), dim(' tools '), plain(str('query'))]
    case 'Skill':
      return [verb('Skill'), plain(` ${str('skill')}`)]
    case 'LSP':
      return [verb('LSP'), plain(` ${str('operation')} `), { text: str('filePath'), kind: 'path' }, { text: `:${String(input.line ?? '')}`, kind: 'range' }]
    default: {
      const args = argsSummary(input)

      return [verb(labelFor(call.tool)), ...(args ? [dim(` ${args}`)] : [])]
    }
  }
}

export function hintFor(call: ToolGroupCall): string {
  return hintParts(call).map(part => part.text).join('')
}

export type Row = { calls: ToolGroupCall[]; parts: Part[]; text: string }

// Back-to-back successful reads share one row (`Read a.ts, b.ts`), as Codex merges them.
export function rowsFor(calls: readonly ToolGroupCall[]): Row[] {
  const rows: Row[] = []

  for (const call of calls) {
    const last = rows.at(-1)
    const isPlainRead = call.tool === 'Read' && !call.isErrored && !call.isRunning

    if (isPlainRead && last && last.calls.every(c => c.tool === 'Read' && !c.isErrored && !c.isRunning)) {
      last.calls.push(call)
      last.parts.push(dim(', '), ...readParts(call))
    } else {
      rows.push({ calls: [call], parts: hintParts(call), text: '' })
    }
  }

  return rows.map(row => ({ ...row, text: row.parts.map(part => part.text).join('') }))
}

// Long previews keep their head and tail around a `… +N lines` marker.
export function previewLines(lines: string[], budget: number): string[] {
  if (lines.length <= budget) {
    return lines
  }

  const head = Math.ceil((budget - 1) / 2)
  const tail = budget - 1 - head

  return [...lines.slice(0, head), `… +${lines.length - head - tail} lines`, ...(tail > 0 ? lines.slice(-tail) : [])]
}

function statusColor(calls: ToolGroupCall[]): string {
  if (calls.some(c => c.isErrored)) return 'red'
  if (calls.some(c => c.isInterrupted)) return 'yellow'
  if (calls.some(c => c.isRunning)) return 'gray'

  return 'green'
}

// What a read-like call brought back: its size, and its lines for the preview.
export function contentOf(call: ToolGroupCall): { size: string; lines: string[] } | undefined {
  const output = call.output as Record<string, unknown> | undefined
  const file = output?.file as { content?: unknown; numLines?: unknown; totalLines?: unknown } | undefined

  if (call.tool === 'Read' && output?.type === 'text' && typeof file?.content === 'string') {
    return { size: `${String(file.numLines)} lines`, lines: file.content.split('\n') }
  }

  if (call.tool === 'Bash' && typeof output?.stdout === 'string') {
    if (output.stdout.trim() !== '') {
      const lines = output.stdout.replace(/\n$/, '').split('\n')

      return { size: `${lines.length} lines`, lines }
    }

    // `cat >> file <<'EOF'` prints nothing; what it wrote is the heredoc body.
    const command = (call.input as { command?: unknown } | undefined)?.command
    const heredoc = typeof command === 'string' ? /<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\1\s*$/m.exec(command) : null

    return heredoc ? { size: `no output, wrote ${heredoc[2]!.split('\n').length} lines`, lines: heredoc[2]!.replace(/^\n+/, '').split('\n') } : { size: 'no output', lines: [] }
  }

  return undefined
}

function clip(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text
}

export const register: Register = on => {
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const own = await next(e)
    const cwd = `${await $.session.cwd()}/`

    if (e.props.isExpanded || e.props.calls.length === 0) {
      return own
    }

    const { Box, Text } = $.ui.resolve(e)
    const width = (e.viewport?.columns ?? 100) - 10
    const rows = rowsFor(e.props.calls)
    const shown = rows.slice(0, MAX_HINTS)
    const rest = rows.length - shown.length
    const perRow = Math.max(2, Math.floor(PREVIEW_LINES / shown.length))

    // A path reads by its file name: the directory stays quiet, the name stands out.
    const drawPart = (part: Part) => {
      const text = part.text.replaceAll(cwd, '')

      switch (part.kind) {
        case 'verb':
          return <Text bold color={VERB_COLOR[part.text] ?? 'blue'}>{text}</Text>
        case 'path': {
          const cut = text.lastIndexOf('/') + 1

          return (
            <Text>
              <Text dimColor>{text.slice(0, cut)}</Text>
              <Text bold>{text.slice(cut)}</Text>
            </Text>
          )
        }
        case 'range':
          return <Text color="yellow">{text}</Text>
        case 'pattern':
          return <Text color="yellow">{text}</Text>
        case 'dim':
          return <Text dimColor>{text}</Text>
        default:
          return <Text>{text}</Text>
      }
    }

    // Keep the row to one line: drop parts past the width, then cut the last one.
    const fit = (parts: Part[], room: number): Part[] => {
      const out: Part[] = []
      let left = room

      for (const part of parts) {
        const text = part.text.replaceAll(cwd, '')
        if (left <= 1) break
        out.push({ ...part, text: text.length > left ? clip(text, left) : text })
        left -= text.length
      }

      return out
    }

    return (
      <Box flexDirection="column">
        {own}
        <Box flexDirection="column" paddingLeft={2}>
          {shown.map(row => {
            const content = row.calls.length === 1 ? contentOf(row.calls[0]!) : undefined
            const size = content ? `  · ${content.size}` : ''

            return (
              <Box flexDirection="column">
                <Text wrap="truncate-end">
                  <Text color={statusColor(row.calls)}>{'• '}</Text>
                  {fit(row.parts, width - size.length).map(drawPart)}
                  <Text dimColor italic>{size}</Text>
                </Text>
                {previewLines(content?.lines ?? [], perRow).map(line =>
                  /^… \+\d+ lines$/.test(line) ? (
                    <Text dimColor italic>{`  ┆ ${line}`}</Text>
                  ) : (
                    <Text wrap="truncate-end">
                      <Text color="gray">{'  │ '}</Text>
                      <Text dimColor>{clip(line, width - 4)}</Text>
                    </Text>
                  ),
                )}
              </Box>
            )
          })}
          {rest > 0 ? <Text dimColor italic>{`… ${rest} more`}</Text> : null}
        </Box>
      </Box>
    )
  })
}
