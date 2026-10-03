// How each tool's call reads as a card: a colored label, one readable title, and an optional
// dim detail line. `null` keeps Claude Code's own row (or another plugin's, like feedback's).

export type Card = { label: string; color: string; title: string; detail?: string }
type Input = Record<string, unknown>

const str = (value: unknown) => (typeof value === 'string' ? value : '')
const home = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')
const base = (path: string) => path.split('/').pop() ?? path
const dir = (path: string) => home(path.split('/').slice(0, -1).join('/'))
const human = (name: string) => name.replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase())
const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''

function browser(action: string, input: Input): Card {
  const target = str(input.url) || str(input.uid) || str(input.selector)
  const titles: Record<string, string> = {
    navigate_page: `Open ${str(input.url) || str(input.type) || 'page'}`,
    new_page: `New tab ${str(input.url)}`,
    click: `Click ${target}`,
    fill: `Fill ${target}`,
    fill_form: 'Fill form',
    hover: `Hover ${target}`,
    press_key: `Press ${str(input.key)}`,
    type_text: `Type "${str(input.text)}"`,
    evaluate_script: 'Run script in page',
    take_snapshot: 'Snapshot page',
    take_screenshot: 'Screenshot',
    list_pages: 'List tabs',
    select_page: 'Switch tab',
    wait_for: `Wait for "${str(input.text)}"`,
  }

  return {
    label: 'Browser',
    color: 'magenta',
    title: titles[action] ?? human(action),
    detail: action === 'evaluate_script' ? firstLine(str(input.function)) : undefined,
  }
}

function docs(action: string, input: Input): Card {
  const query = `"${str(input.query)}"`
  const titles: Record<string, string> = {
    find_docs: `Search ${query}`,
    read_doc: str(input.path),
    list_docs: input.source && input.source !== 'all' ? `List ${human(str(input.source))}` : 'List docs',
    find_libs: `Package ${query}`,
  }

  return { label: action === 'find_libs' ? 'Packages' : 'Docs', color: 'yellow', title: titles[action] ?? human(action) }
}

export function describe(tool: string, input: Input): Card | null {
  const path = str(input.file_path) || str(input.notebook_path)
  switch (tool) {
    case 'Bash': {
      const command = str(input.command)
      const description = str(input.description)
      // repo-docs draws its own reindex row.
      if (!description || command.includes('build-semantic-index.cjs')) return null
      const lines = command.trim().split('\n')
      return {
        label: 'Bash',
        color: 'blackBright',
        title: description,
        detail: `$ ${lines[0] ?? ''}${lines.length > 1 ? `  (+${lines.length - 1} lines)` : ''}`,
      }
    }
    case 'Read': {
      const offset = Number(input.offset ?? 0)
      const limit = Number(input.limit ?? 0)
      const range = limit ? `  lines ${offset + 1}–${offset + limit}` : ''
      return { label: 'Read', color: 'blue', title: `${base(path)}${range}`, detail: dir(path) }
    }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { label: 'Edit', color: 'yellow', title: base(path), detail: dir(path) }
    case 'Write':
      return { label: 'Write', color: 'yellow', title: base(path), detail: dir(path) }
    case 'Grep':
    case 'Glob':
      return { label: 'Search', color: 'cyan', title: `"${str(input.pattern)}"`, detail: home(str(input.path)) || undefined }
    case 'WebFetch': {
      const url = str(input.url)
      return { label: 'Web', color: 'cyan', title: url.replace(/^https?:\/\//, ''), detail: firstLine(str(input.prompt)) }
    }
    case 'WebSearch':
      return { label: 'Web', color: 'cyan', title: `Search "${str(input.query)}"` }
    case 'ToolSearch':
      return { label: 'Tools', color: 'blackBright', title: `Load ${str(input.query).replace(/^select:/, '')}` }
    case 'Skill': {
      const [plugin, name] = str(input.skill).includes(':') ? str(input.skill).split(':') : ['', str(input.skill)]
      return { label: 'Skill', color: 'magenta', title: `/${name}`, detail: firstLine(str(input.args)) || (plugin ? `from ${plugin}` : undefined) }
    }
    case 'Agent':
    case 'Task':
      return { label: 'Agent', color: 'green', title: str(input.description), detail: str(input.subagent_type) || undefined }
  }
  const mcp = tool.match(/^mcp__(.+?)__(.+)$/)
  if (!mcp?.[1] || !mcp[2]) return null
  const server = mcp[1].replace(/^plugin_[^_]+_/, '')
  // The feedback plugin draws its own rows.
  if (server === 'feedback') return null
  if (server === 'chrome-devtools') return browser(mcp[2], input)
  if (server === 'repo-docs') return docs(mcp[2], input)
  if (server === 'codegraph') return { label: 'Code', color: 'yellow', title: firstLine(str(input.query)) }
  const firstArg = Object.values(input).find(value => typeof value === 'string') as string | undefined

  return { label: human(server), color: 'blue', title: human(mcp[2]), detail: firstArg ? firstLine(firstArg) : undefined }
}

// A PNG the tool returned as an MCP image block (a browser screenshot), with its size from the
// PNG header so the picture keeps its shape.
export function pngIn(output: unknown): { png: string; width: number; height: number } | null {
  type Block = { type?: string; data?: string; mimeType?: string; source?: { data?: string; media_type?: string } }
  const blocks: Block[] = Array.isArray(output) ? output : []
  // The MCP block form, or the API's `source` form the transcript stores.
  const image = blocks.find(block => block.type === 'image' && (block.mimeType ?? block.source?.media_type) === 'image/png')
  const png = image?.data ?? image?.source?.data
  if (!png) return null
  const head = atob(png.slice(0, 44))
  const at = (i: number) => ((head.charCodeAt(i) << 24) | (head.charCodeAt(i + 1) << 16) | (head.charCodeAt(i + 2) << 8) | head.charCodeAt(i + 3)) >>> 0

  return { png, width: at(16), height: at(20) }
}

