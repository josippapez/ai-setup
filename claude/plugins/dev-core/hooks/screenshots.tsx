import type { On } from 'claude-code'

const SCREENSHOT = 'mcp__plugin_dev-core_chrome-devtools__take_screenshot'
const COLUMNS = 64

type Block = { type?: string; text?: string; data?: string; mimeType?: string; source?: { data?: string; media_type?: string } }

// The screenshot as the result carries it: an MCP image block (or the API's
// `source` form of one), or, over 2 MB, a "Saved screenshot to <path>." line.
function findPng(output: unknown): { png: string } | { file: string; format: 'png' } | null {
  const blocks: Block[] = Array.isArray(output) ? output : []
  for (const block of blocks) {
    const data = block.data ?? block.source?.data
    const type = block.mimeType ?? block.source?.media_type
    if (block.type === 'image' && data && type === 'image/png') return { png: data }
  }
  const text = blocks.map(block => block.text ?? '').join('\n') || (typeof output === 'string' ? output : '')
  const saved = text.match(/Saved screenshot to (\/\S+\.png)\./)?.[1]

  return saved ? { file: saved, format: 'png' as const } : null
}

// Width and height from the PNG header (IHDR), to keep the picture's shape.
function pngSize(base64: string) {
  const head = atob(base64.slice(0, 44))
  const at = (i: number) => ((head.charCodeAt(i) << 24) | (head.charCodeAt(i + 1) << 16) | (head.charCodeAt(i + 2) << 8) | head.charCodeAt(i + 3)) >>> 0

  return { width: at(16), height: at(20) }
}

export function registerScreenshots(on: On) {
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== SCREENSHOT || e.props.isErrored || e.surface !== 'terminal') return next(e)
    const source = findPng(e.props.output)
    if (source === null) return next(e)
    const { Box, Image, Text } = $.ui.resolve(e)
    const size = 'png' in source ? pngSize(source.png) : { width: 16, height: 10 }
    // A terminal cell is about twice as tall as it is wide.
    const rows = Math.min(40, Math.max(1, Math.round((COLUMNS * size.height) / size.width / 2)))

    return (
      <Box marginX={1} flexDirection="column">
        <Image source={source} columns={COLUMNS} rows={rows} alt="Browser screenshot" />
        <Text dimColor>
          {'png' in source ? `${size.width}×${size.height}` : source.file}
        </Text>
      </Box>
    )
  })
}
