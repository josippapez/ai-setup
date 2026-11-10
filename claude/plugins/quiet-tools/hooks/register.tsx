import type { Register } from 'claude-code'

// One line that names the call: the skill, or the MCP server and tool plus its first short argument.
export function summary(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  if (tool === 'Skill') return `Skill ${typeof i.skill === 'string' ? i.skill : ''}`.trim()
  const mcp = /^mcp__(?:plugin_[^_]+_)?(.+?)__(.+)$/.exec(tool)
  const name = mcp ? `${mcp[1]} › ${mcp[2]}` : tool
  const arg = Object.values(i).find(v => typeof v === 'string' && v.length > 0) as string | undefined
  return arg ? `${name} ${arg.split('\n')[0]}` : name
}

// Only skill and MCP calls are restyled. Every other tool keeps Claude Code's own row.
export const colorFor = (tool: string): string | undefined => (tool === 'Skill' ? 'magenta' : tool.startsWith('mcp__') ? 'cyan' : undefined)

// Rows the person clicked open, by tool_use_id.
const open = new Set<string>()

function toggle($: { ui: { invalidate: (event: 'ui.render') => void } }, id: string) {
  if (open.has(id)) open.delete(id)
  else open.add(id)
  $.ui.invalidate('ui.render')
}

// The open block's last line: a full-width bar, so folding it back is one easy click.
const foldLabel = (columns: number | undefined) => `▴ fold ${'─'.repeat(Math.max(4, (columns ?? 80) - 12))}`

export const register: Register = on => {
  // A skill or MCP call: one bold colored line, clicked open to the engine's full row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { tool_use_id, tool, input, isRunning, isErrored, isInterrupted } = e.props
    const color = colorFor(tool)
    if (e.props.isExpanded || !color) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const mark = isErrored ? '✗' : isInterrupted ? '⊘' : isRunning ? '…' : '·'
    const line = (
      <Button key={`call-${tool_use_id}`} plain onPress={() => toggle($, tool_use_id)}>
        <Text bold color={isErrored ? 'error' : color} wrap="truncate-end">
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

  // A skill or MCP call's output: hidden until its row is clicked open, or ctrl+o.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.isExpanded || !colorFor(e.props.tool)) return next(e)
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
