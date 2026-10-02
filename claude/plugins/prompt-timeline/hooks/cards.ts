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
  const firstArg = Object.values(input).find(value => typeof value === 'string') as string | undefined

  return { label: human(server), color: 'blue', title: human(mcp[2]), detail: firstArg ? firstLine(firstArg) : undefined }
}
