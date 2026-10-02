import type { On } from 'claude-code'

// The /repo-docs:reindex command runs the builder through Bash and prints one
// "repo_docs_index updated=N unchanged=N skipped=N cache=PATH" line.
const BUILDER = 'build-semantic-index.cjs'
const SUMMARY = /repo_docs_index updated=(\d+) unchanged=(\d+) skipped=(\d+) cache=(\S+)(.*)/

const isReindex = (input: unknown) =>
  typeof input === 'object' && input !== null && 'command' in input && String(input.command).includes(BUILDER)

export function registerTranscript(on: On) {
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== 'Bash' || !isReindex(e.props.input)) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box marginX={1} gap={1}>
        <Text color={e.props.isErrored ? 'red' : e.props.isRunning ? 'gray' : 'green'}>●</Text>
        <Text bold>Reindex repo docs</Text>
        {e.props.isRunning && <Text dimColor>embedding changed docs…</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== 'Bash' || e.props.isErrored) return next(e)
    const stdout = typeof e.props.output === 'object' && e.props.output !== null && 'stdout' in e.props.output ? String(e.props.output.stdout) : ''
    const match = stdout.match(SUMMARY)
    if (!match) return next(e)
    const [, updated, unchanged, skipped, cache, note] = match
    const { Box, Text } = $.ui.resolve(e)
    const folder = (cache ?? '').replace(/\/\.claude\/repo-docs\/[^/]+$/, '').split('/').pop()

    return (
      <Box marginX={1} flexDirection="column" paddingLeft={2}>
        <Box gap={2}>
          <Text color="green">✓ {folder}</Text>
          <Text bold color={Number(updated) > 0 ? 'cyan' : undefined}>
            {updated} re-embedded
          </Text>
          <Text dimColor>{unchanged} unchanged</Text>
          {Number(skipped) > 0 && <Text color="yellow">{skipped} skipped</Text>}
        </Box>
        {note?.trim() && <Text color="yellow">{note.trim()}</Text>}
      </Box>
    )
  })
}
