import type { On } from 'claude-code'

const PREFIX = 'mcp__plugin_feedback_feedback__'
const SEVERITY_COLOR: Record<string, string> = { high: 'red', medium: 'yellow', low: 'gray' }
const KIND_LABEL: Record<string, string> = { bug: 'Bug', pain_point: 'Pain point', ambiguity: 'Ambiguity', idea: 'Idea' }

type Input = Record<string, string | number | undefined>

// MCP results reach the row as text or as content blocks; the first line is the summary.
function firstLine(output: unknown) {
  const text = Array.isArray(output)
    ? output.map(block => (block && typeof block === 'object' && 'text' in block ? String(block.text) : '')).join('\n')
    : String(output ?? '')

  return text.split('\n')[0] ?? ''
}

export function registerTranscript(on: On) {
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!e.props.tool.startsWith(PREFIX)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const action = e.props.tool.slice(PREFIX.length)
    const input = (e.props.input ?? {}) as Input
    const dot = <Text color={e.props.isErrored ? 'red' : e.props.isRunning ? 'gray' : 'green'}>●</Text>

    if (action === 'collect_feedback') {
      const severity = String(input.severity ?? 'medium')
      return (
        <Box marginX={1} gap={1}>
          {dot}
          <Text bold>Log feedback</Text>
          <Text backgroundColor={SEVERITY_COLOR[severity] ?? 'gray'} color="black">{` ${severity.toUpperCase()} `}</Text>
          <Text dimColor>{KIND_LABEL[String(input.kind)] ?? String(input.kind)}</Text>
          <Text wrap="truncate-end">{String(input.title ?? '')}</Text>
        </Box>
      )
    }
    if (action === 'update_feedback') {
      const change = input.status ? String(input.status) : 'edit'
      return (
        <Box marginX={1} gap={1}>
          {dot}
          <Text bold>Update feedback</Text>
          <Text dimColor>{String(input.id)}</Text>
          <Text color={change === 'resolved' ? 'green' : undefined}>{change === 'resolved' ? '✓ resolved' : change}</Text>
          {input.resolution !== undefined && <Text dimColor wrap="truncate-end">→ {String(input.resolution)}</Text>}
        </Box>
      )
    }
    const filters = ['status', 'kind', 'severity', 'area', 'query']
      .filter(key => input[key] !== undefined)
      .map(key => `${key}: ${input[key]}`)
    return (
      <Box marginX={1} gap={1}>
        {dot}
        <Text bold>Read feedback</Text>
        <Text dimColor>{filters.length ? filters.join(' · ') : 'open entries'}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!e.props.tool.startsWith(PREFIX) || e.props.isErrored) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box marginX={1}>
        <Text dimColor>  ⎿ {firstLine(e.props.output)}</Text>
      </Box>
    )
  })
}
