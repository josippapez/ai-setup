// How each tool's call reads as a card: a colored label, one readable title, an optional dim
// detail line, and an optional markdown body for text the call sends (a PR comment, a query).
// `null` keeps Claude Code's own row (or another plugin's, like feedback's).

export type Card = { label: string; color: string; title: string; detail?: string; body?: string }
type Input = Record<string, unknown>

const str = (value: unknown) => (typeof value === 'string' ? value : '')
const home = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')
const base = (path: string) => path.split('/').pop() ?? path
const dir = (path: string) => home(path.split('/').slice(0, -1).join('/'))
const human = (name: string) => name.replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase())
const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''
// A shell command as it reads at a prompt: a leading `cd X &&` becomes the folder shown in
// front, home and scratchpad paths shorten, the rtk proxy prefix goes, and a chain of steps
// (`a; b && c`) is split into one step per line, so a long one-liner reads top to bottom.
const SCRATCH = /\/private\/tmp\/claude-\d+\/[^/\s'"]+\/[0-9a-f-]{36}\/scratchpad/g
const STEPS_SHOWN = 4
export function shell(command: string) {
  let rest = command.trim()
  let where = ''
  const cd = rest.match(/^cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)\s*/)
  if (cd?.[1]) {
    where = base(cd[1].replace(/^(['"])(.*)\1$/, '$2').replace(/\/$/, ''))
    rest = rest.slice(cd[0].length)
  }
  const lines = rest.split('\n')
  const first = (lines[0] ?? '').replace(SCRATCH, 'scratchpad').replace(/\/Users\/[^/\s'"]+/g, '~')
  const steps = joinLoops(splitSteps(first))
    .map(step => step.replace(/^rtk\s+/, ''))
    .filter(step => !SEPARATOR.test(step))

  return { where, steps, more: lines.length - 1 }
}

// `echo "==="`, `echo "--- rules:"`: section markers for the output, not steps worth reading.
const SEPARATOR = /^(?:echo|printf)\s+(?:-e\s+)?['"]?(?:\\n)?(?:={2,}|-{2,}|═+|#{2,}|─+)/
// A loop or if is one step: `for f in a b; do x; done` splits at its own semicolons otherwise.
function joinLoops(steps: string[]) {
  const out: string[] = []
  let depth = 0
  for (const step of steps) {
    const opens = /^(?:for|while|until|if|case)\b/.test(step) ? 1 : 0
    const closes = /^(?:done|fi|esac)\b/.test(step) ? 1 : 0
    if (depth > 0) out[out.length - 1] += `; ${step}`
    else out.push(step)
    depth = Math.max(0, depth + opens - closes)
  }

  return out
}

// Split on && || ; outside quotes and $( ), keeping pipes inside a step.
function splitSteps(line: string) {
  const out: string[] = []
  let buf = ''
  let quote = ''
  let depth = 0
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i] ?? ''
    if (quote) {
      if (c === quote && line[i - 1] !== '\\') quote = ''
      buf += c
      continue
    }
    if (c === '"' || c === "'") quote = c
    if (c === '(') depth += 1
    if (c === ')') depth = Math.max(0, depth - 1)
    const two = line.slice(i, i + 2)
    if (depth === 0 && (two === '&&' || two === '||' || c === ';')) {
      if (buf.trim()) out.push(buf.trim())
      buf = ''
      if (two === '&&' || two === '||') i += 1
      continue
    }
    buf += c
  }
  if (buf.trim()) out.push(buf.trim())

  return out
}

export function shellDetail(command: string) {
  const { where, steps, more } = shell(command)
  const shown = steps.slice(0, STEPS_SHOWN).map((step, i) => `${i === 0 ? `${where ? `${where} ` : ''}$ ` : '  '}${step}`)
  const rest = [steps.length > STEPS_SHOWN ? `+${steps.length - STEPS_SHOWN} more steps` : '', more ? `+${more} lines` : ''].filter(Boolean)

  return `${shown.join('\n')}${rest.length ? `  (${rest.join(', ')})` : ''}`
}

const lineCount = (text: string) => (text ? text.split('\n').length : 0)
// A script's first line that says something: `() => {` and `async () => {` say nothing.
const firstCode = (code: string) => code.split('\n').map(line => line.trim()).find(line => line && !/^(async\s*)?(\(\)|function\s*\(\))\s*(=>)?\s*\{?$/.test(line)) ?? ''

function browser(action: string, input: Input): Card {
  const target = str(input.url) || str(input.uid) || str(input.selector)
  const moves: Record<string, string> = { reload: 'Reload page', back: 'Go back', forward: 'Go forward' }
  const waitFor = Array.isArray(input.text) ? input.text.join('" or "') : str(input.text)
  const titles: Record<string, string> = {
    navigate_page: str(input.url) ? `Open ${str(input.url)}` : (moves[str(input.type)] ?? 'Navigate'),
    new_page: `New tab ${str(input.url)}`,
    click: `${input.dblClick ? 'Double-click' : 'Click'} ${target}`,
    fill: `Fill ${target}`,
    fill_form: 'Fill form',
    hover: `Hover ${target}`,
    press_key: `Press ${str(input.key)}`,
    type_text: `Type "${str(input.text)}"`,
    evaluate_script: 'Run script in page',
    take_snapshot: 'Snapshot page',
    take_screenshot: input.fullPage ? 'Screenshot (full page)' : 'Screenshot',
    list_pages: 'List tabs',
    select_page: 'Switch tab',
    wait_for: `Wait for "${waitFor}"`,
    resize_page: `Resize to ${input.width}×${input.height}`,
    emulate: `${[str(input.viewport), str(input.networkConditions), input.cpuThrottlingRate ? `CPU ×${input.cpuThrottlingRate}` : ''].filter(Boolean).join(', ').replace(/^(?=.)/, 'Emulate ') || 'Reset emulation'}`,
  }

  return {
    label: 'Browser',
    color: 'magenta',
    title: titles[action] ?? human(action),
    detail: action === 'evaluate_script' ? firstCode(str(input.function)) : undefined,
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

// Any other MCP call: the action in the title; the ids, branches, file and line, or design node
// as the detail; and the text it sends (a comment, a description, a query) as a markdown body,
// whole, so its code spans and line breaks survive.
const TEXT_KEYS = ['content', 'text', 'body', 'message', 'comment', 'description', 'prompt']
const QUERY_KEYS = ['wiql', 'query', 'sql']
// Context every call in a project repeats; it says nothing about this call.
const QUIET = new Set(['action', 'project', 'repositoryId', 'version', 'versionType', 'pageId'])
function mcpSummary(tool: string, input: Input) {
  const action = str(input.action)
  const ids = Array.isArray(input.ids) ? (input.ids as unknown[]) : []
  const id = Object.entries(input).find(([key, value]) => /Id$/.test(key) && typeof value === 'number')?.[1]
  const idText = ids.length ? `#${ids.slice(0, 3).join(', #')}${ids.length > 3 ? ` +${ids.length - 3}` : ''}` : id === undefined ? '' : `#${id}`
  const branch = (ref: unknown) => str(ref).replace(/^refs\/heads\//, '')
  const branches = input.sourceRefName ? `${branch(input.sourceRefName)} → ${branch(input.targetRefName)}` : input.targetRefName ? `into ${branch(input.targetRefName)}` : ''
  const file = str(input.filePath) || str(input.file_path) || str(input.path) || str(input.url)
  const line = [input.rightFileStartLine, input.startLine, input.line].find(value => typeof value === 'number')
  const node = str(input.nodeId) ? `node ${str(input.nodeId)}` : ''
  const title = str(input.title)
  const text = TEXT_KEYS.map(key => str(input[key])).find(Boolean) ?? ''
  const query = QUERY_KEYS.map(key => str(input[key])).find(Boolean) ?? ''
  const parts = [idText, branches, str(input.status), file ? `${base(file)}${line === undefined ? '' : `:${line}`}` : '', node, title ? `"${title}"` : '']
  const fallback = Object.entries(input).find(([key, value]) => typeof value === 'string' && !QUIET.has(key) && value !== text && value !== query)?.[1] as string | undefined
  const detail = parts.filter(Boolean).join(' · ') || (fallback && !text && !query ? firstLine(fallback) : '')
  const body = text || (query ? `\`\`\`\n${query}\n\`\`\`` : '')

  return { title: `${human(tool)}${action ? ` · ${action}` : ''}`, detail: detail || undefined, body: body || undefined }
}

export function describe(tool: string, input: Input): Card | null {
  const path = str(input.file_path) || str(input.notebook_path)
  switch (tool) {
    case 'Bash': {
      const command = str(input.command)
      // repo-docs draws its own reindex row.
      if (command.includes('build-semantic-index.cjs')) return null
      const description = str(input.description)
      const detail = shellDetail(command)
      // With no description the command itself is the title.
      if (!description) return { label: 'Bash', color: 'blackBright', title: detail.split('\n')[0] ?? '', detail: detail.split('\n').slice(1).join('\n') || undefined }
      return { label: 'Bash', color: 'blackBright', title: description, detail }
    }
    case 'Read': {
      const offset = Number(input.offset ?? 0)
      const limit = Number(input.limit ?? 0)
      const range = limit ? `  lines ${offset + 1}–${offset + limit}` : ''
      return { label: 'Read', color: 'blue', title: `${base(path)}${range}`, detail: dir(path) }
    }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const removed = lineCount(str(input.old_string))
      const added = lineCount(str(input.new_string))
      const size = removed || added ? `  −${removed} +${added} lines${input.replace_all ? ', every match' : ''}` : ''
      return { label: 'Edit', color: 'yellow', title: `${base(path)}${size}`, detail: dir(path) }
    }
    case 'Write':
      return { label: 'Write', color: 'yellow', title: `${base(path)}  ${lineCount(str(input.content))} lines`, detail: dir(path) }
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
    case 'SendMessage':
      return { label: 'Agent', color: 'green', title: `Message: ${str(input.summary) || firstLine(str(input.message))}`, detail: `to ${str(input.to)}` }
    case 'TaskStop':
      return { label: 'Task', color: 'blackBright', title: `Stop ${str(input.task_id)}` }
    case 'ReadNotifications':
      return { label: 'Inbox', color: 'blackBright', title: 'Read notifications' }
    case 'SendUserFile': {
      const files = Array.isArray(input.files) ? (input.files as string[]) : []
      return { label: 'File', color: 'green', title: `Send ${files.map(base).join(', ')}`, detail: firstLine(str(input.caption)) || undefined }
    }
    case 'Agent':
    case 'Task':
      return { label: 'Agent', color: 'green', title: str(input.description), detail: str(input.subagent_type) || undefined }
  }
  const mcp = tool.match(/^mcp__(.+?)__(.+)$/)
  if (!mcp?.[1] || !mcp[2]) return null
  const server = mcp[1].replace(/^plugin_[^_]+_/, '').replace(/^claude_ai_/, '')
  // The feedback plugin draws its own rows.
  if (server === 'feedback') return null
  if (server === 'chrome-devtools') return browser(mcp[2], input)
  if (server === 'repo-docs') return docs(mcp[2], input)
  if (server === 'codegraph') return { label: 'Code', color: 'yellow', title: firstLine(str(input.query)) }
  return { label: human(server), color: 'blue', ...mcpSummary(mcp[2], input) }
}

// An MCP result keeps its line breaks, so a list of hits reads as a list. find_docs shows every
// hit; other results show RESULT_LINES and say how many they left out. read_doc returns a whole
// doc, so it reads like Read: a line count.
const RESULT_LINES = 8
function mcpResult(tool: string, text: string) {
  if (/repo-docs__read_doc$/.test(tool)) return `${text.split('\n').length} lines`
  const lines = text.trim().split('\n').filter(line => line.trim())
  if (/repo-docs__find_docs$/.test(tool) || lines.length <= RESULT_LINES) return lines.join('\n')
  return [...lines.slice(0, RESULT_LINES), `… +${lines.length - RESULT_LINES} more lines`].join('\n')
}

// A call that errored stores the error text the model read in place of its result.
export function errorLines(output: unknown): string | undefined {
  return typeof output === 'string' && output.trim() ? mcpResult('', output) : undefined
}

// What a call returned, for rows inside an expanded group, where Claude Code draws the result
// inline instead of as its own row. One line, except an MCP result, which keeps its lines.
export function resultLine(tool: string, output: unknown): string | undefined {
  const o = (output ?? {}) as Record<string, unknown>
  const num = (value: unknown) => (typeof value === 'number' ? value : undefined)
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  switch (tool) {
    case 'Read': {
      const file = (o.file ?? {}) as Record<string, unknown>
      const lines = num(file.numLines)
      if (o.type === 'image') return 'image'
      if (lines === undefined) return undefined
      const total = num(file.totalLines)
      return total !== undefined && total > lines ? `${lines} of ${total} lines` : plural(lines, 'line')
    }
    case 'Grep':
    case 'Glob': {
      if (typeof output === 'string') return firstLine(output)
      const matches = num(o.numMatches) ?? num(o.numLines)
      const files = num(o.numFiles)
      return [files === undefined ? '' : plural(files, 'file'), matches === undefined ? '' : plural(matches, 'match')].filter(Boolean).join(', ') || undefined
    }
    case 'WebFetch':
      return o.code === undefined ? undefined : `${o.code} ${str(o.codeText)} · ${Math.round(Number(o.bytes ?? 0) / 1024)} KB`
    case 'WebSearch':
      return Array.isArray(o.results) ? plural(o.results.length, 'result') : undefined
    case 'ToolSearch':
      return Array.isArray(o.matches) ? `${plural(o.matches.length, 'tool')} loaded` : undefined
    case 'Agent':
    case 'Task': {
      const tools = num(o.totalToolUseCount)
      const tokens = num(o.totalTokens)
      const ms = num(o.totalDurationMs)
      const parts = [o.status && o.status !== 'completed' ? str(o.status) : '', tools === undefined ? '' : plural(tools, 'tool call'), tokens === undefined ? '' : `${Math.round(tokens / 1000)}k tokens`, ms === undefined ? '' : `${Math.round(ms / 1000)}s`]
      return parts.filter(Boolean).join(' · ') || undefined
    }
  }
  if (Array.isArray(output)) {
    const text = (output as { type?: string; text?: string }[]).find(block => block.type === 'text')?.text
    return text ? mcpResult(tool, text) : undefined
  }

  return undefined
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

