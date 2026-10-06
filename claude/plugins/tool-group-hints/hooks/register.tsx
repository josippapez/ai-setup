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

export function hintFor(call: ToolGroupCall): string {
  const input = (call.input ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')

  switch (call.tool) {
    case 'Bash':
      return `$ ${str('command').replace(/^\s*cd \S+\s*(&&|;)\s*/, '').split('\n')[0]}`
    case 'Grep':
      return `/${str('pattern')}/${str('path') ? ` in ${str('path')}` : ''}${str('glob') ? ` (${str('glob')})` : ''}`
    case 'Glob':
      return str('pattern') + (str('path') ? ` in ${str('path')}` : '')
    case 'Read':
      return str('file_path')
    case 'WebFetch':
      return str('url')
    case 'WebSearch':
    case 'ToolSearch':
      return str('query')
    case 'Skill':
      return str('skill')
    case 'LSP':
      return `${str('operation')} ${str('filePath')}:${String(input.line ?? '')}`
    default:
      return argsSummary(input)
  }
}

// What a read-like call brought back: its size, and its lines for the preview.
export function contentOf(call: ToolGroupCall): { size: string; lines: string[] } | undefined {
  const output = call.output as Record<string, unknown> | undefined
  const file = output?.file as { content?: unknown; numLines?: unknown; totalLines?: unknown } | undefined

  if (call.tool === 'Read' && output?.type === 'text' && typeof file?.content === 'string') {
    const total = file.totalLines !== file.numLines ? ` of ${String(file.totalLines)}` : ''

    return { size: `${String(file.numLines)}${total} lines`, lines: file.content.split('\n') }
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
    const width = (e.viewport?.columns ?? 100) - 8
    const calls = e.props.calls.slice(0, MAX_HINTS)
    const rest = e.props.calls.length - calls.length
    const perCall = Math.max(2, Math.floor(PREVIEW_LINES / calls.length))

    return (
      <Box flexDirection="column">
        {own}
        {calls.map(call => {
          const content = contentOf(call)
          const size = content ? `  (${content.size})` : ''
          const shown = content?.lines.slice(0, perCall) ?? []

          return (
            <Box flexDirection="column">
              <Text dimColor wrap="truncate-end">
                {'    '}
                {call.isErrored ? '✗ ' : '· '}
                {clip(`${labelFor(call.tool)} ${hintFor(call).replaceAll(cwd, '')}${size}`, width)}
              </Text>
              {shown.map(line => (
                <Text dimColor wrap="truncate-end">{clip(`        │ ${line}`, width)}</Text>
              ))}
            </Box>
          )
        })}
        {rest > 0 ? <Text dimColor>{`    … ${rest} more`}</Text> : null}
      </Box>
    )
  })
}
