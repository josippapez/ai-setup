import type { Register, ToolGroupCall } from 'claude-code'

// One line that names the call: the command for Bash, the file for file tools.
export function summary(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const pick = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '')
  const first = (s: string) => s.split('\n')[0]
  if (tool === 'Bash') return `$ ${first(pick('command'))}`
  const target =
    pick('file_path') || pick('path') || pick('pattern') || pick('url') ||
    pick('description') || pick('query') || pick('skill') || pick('prompt')
  return target ? `${tool} ${first(target)}` : tool
}

// mcp__plugin_<plugin>_<server>__<tool> and mcp__<server>__<tool> read as the server.
const toolName = (tool: string) => /^mcp__(?:plugin_[^_]+_)?(.+?)__/.exec(tool)?.[1] ?? tool

// The group's count line, as the engine words it: "Read 2 files, ran 3 shell commands".
// It is redrawn here so the whole line can be one click target.
export function groupLine(calls: readonly ToolGroupCall[]): string {
  const counts = new Map<string, number>()
  for (const c of calls) {
    const kind = c.tool === 'Bash' ? 'bash' : c.tool === 'Read' ? 'read' : c.tool === 'Grep' || c.tool === 'Glob' ? 'search' : `call ${toolName(c.tool)}`
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`
  const line = [...counts]
    .map(([kind, k]) =>
      kind === 'bash' ? `ran ${n(k, 'shell command')}` : kind === 'read' ? `read ${n(k, 'file')}` : kind === 'search' ? `searched for ${n(k, 'pattern')}` : `called ${kind.slice(5)}`,
    )
    .join(', ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

// Rows the person clicked open, by tool_use_id or group id.
const open = new Set<string>()

function toggle($: { ui: { invalidate: (event: 'ui.render') => void } }, id: string) {
  if (open.has(id)) open.delete(id)
  else open.add(id)
  $.ui.invalidate('ui.render')
}

// The open block's last line: a full-width bar, so folding it back is one easy click.
const foldLabel = (columns: number | undefined) => `▴ fold ${'─'.repeat(Math.max(4, (columns ?? 80) - 12))}`

export const register: Register = on => {
  // A finished group: one clickable count line that unfolds into its calls.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.isActive || e.props.isCallsOnly !== true) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isOpen = open.has(e.requestId)
    const header = (
      <Button key={`group-${e.requestId}`} plain onPress={() => toggle($, e.requestId)}>
        <Text dimColor={!isOpen} bold={isOpen}>
          {isOpen ? '▾' : '▸'} {groupLine(e.props.calls)}
        </Text>
      </Button>
    )
    if (!isOpen) return header
    return (
      <Box flexDirection="column">
        {header}
        {await next({ ...e, props: { ...e.props, isExpanded: true } })}
        <Button key={`fold-${e.requestId}`} plain onPress={() => toggle($, e.requestId)}>
          <Text dimColor>{foldLabel(e.viewport?.columns)}</Text>
        </Button>
      </Box>
    )
  })

  // A call on its own: one dim line, clicked open to the engine's full row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const { tool_use_id, tool, input, isRunning, isErrored, isInterrupted } = e.props
    const mark = isErrored ? '✗' : isInterrupted ? '⊘' : isRunning ? '…' : '·'
    const line = (
      <Button key={`call-${tool_use_id}`} plain onPress={() => toggle($, tool_use_id)}>
        <Text dimColor={!isErrored && !open.has(tool_use_id)} bold={open.has(tool_use_id)} color={isErrored ? 'error' : undefined} wrap="truncate-end">
          {mark} {summary(tool, input)}
        </Text>
      </Button>
    )
    if (!open.has(tool_use_id)) return line
    return (
      <Box flexDirection="column">
        {line}
        {await next(e)}
      </Box>
    )
  })

  // The output under a call: hidden until its row is clicked open, or ctrl+o.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const id = e.props.tool_use_id
    if (!open.has(id)) return <Box />
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Button key={`fold-${id}`} plain onPress={() => toggle($, id)}>
          <Text dimColor>{foldLabel(e.viewport?.columns)}</Text>
        </Button>
      </Box>
    )
  })
}
