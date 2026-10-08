import { expect, mock, test } from 'claude-code/testing'

import { familyColor, fitColumns, modelLabel, parseTable, scriptOf, splitTables, tableWidth, wrappedLines } from '../hooks/look'

test('model ids read as short names', () => {
  expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(modelLabel('some-other-model[1m]')).toBe('some-other-model')
  expect(familyColor('Opus 5.5')).toBe('magenta')
  expect(familyColor('Haiku 4.5')).toBe('green')
  expect(familyColor('some-other-model')).toBe('gray')
})

test('tables are split out of prose so they can be drawn at full width', () => {
  const text = 'Intro line.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n```\n| not a table |\n```'
  expect(splitTables(text).map(part => part.isTable)).toEqual([false, true, false])
  expect(splitTables(text)[1]?.text).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  expect(splitTables(text)[2]?.text).toContain('| not a table |')
})

test('a table is measured at the width the markdown element draws it', () => {
  expect(tableWidth('| Tool | Calls |\n| --- | --- |\n| Bash | 2151 |')).toBe(16)
})

test('a cell wraps by words, so its row height and dividers match the text', () => {
  expect(wrappedLines('short', 10)).toBe(1)
  expect(wrappedLines('one two three', 9)).toBe(2)
  expect(wrappedLines('one two three four', 9)).toBe(3)
  expect(wrappedLines('abcdefghijkl', 5)).toBe(3)
})

test('a table parses into header and rows, and its columns fit the room given', () => {
  expect(parseTable('| Tool | Calls |\n| --- | --- |\n| Bash | 2151 |')).toEqual({ header: ['Tool', 'Calls'], rows: [['Bash', '2151']] })
  // Everything fits: natural widths.
  expect(fitColumns([4, 5], 40, 2)).toEqual([4, 5])
  // Too wide: the narrow column keeps its width, the long ones share the rest.
  const widths = fitColumns([10, 80, 90], 100, 2)
  expect(widths[0]).toBe(10)
  expect(widths.reduce((a, b) => a + b, 0) + 4).toBeLessThanOrEqual(100)
})

test('a reply is plain text and its turn footer names the model and effort that made it; notices get a command pill', async ($, on) => {
  const clock = mock.clock(on)
  const stored: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.id', () => ({ value: 's' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '[]', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine reply</Text>
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1 })) void _

  const footer = async () => {
    const ui = await $.ui.mount({ plugin: 'prompt-timeline', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3000 } })
    const text = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('')
    await ui.unmount()
    return text
  }
  const reply = (isFirstOfReply: boolean) =>
    ({ plugin: 'prompt-timeline', component: 'AssistantMessage', props: { text: 'The fix is **in**.', isFirstOfReply } }) as const
  for (const surface of ['terminal', 'desktop'] as const) {
    const first = await $.ui.mount({ surface, requestId: 'reply-1', ...reply(true) })
    expect(await first.find({ type: 'Markdown' })).toBeDefined()
    await first.unmount()
    expect(await footer()).toBe('◆ Sonnet 5.5 · high · 3s')
    const later = await $.ui.mount({ surface, ...reply(false) })
    expect(await later.find({ type: 'Markdown' })).toBeDefined()
    expect(await later.find({ text: 'engine reply' })).toBeUndefined()
    await later.unmount()
  }

  // A later switch does not relabel a reply already drawn.
  await clock.advance(1)
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'claude-haiku-4-5', effort: 'low', messageCount: 3 })) void _
  // After a resume the reply may be drawn under a new id; its text still finds its tag.
  const redrawn = await $.ui.mount({ surface: 'terminal', requestId: 'resumed-1', ...reply(true) })
  await redrawn.unmount()
  expect(await footer()).toBe('◆ Sonnet 5.5 · high · 3s')
  expect(stored['replies:s']).toEqual({ 'The fix is **in**.': { model: 'Sonnet 5.5', effort: 'high' } })
  const fresh = await $.ui.mount({
    surface: 'terminal',
    requestId: 'reply-2',
    plugin: 'prompt-timeline',
    component: 'AssistantMessage',
    props: { text: 'A newer reply.', isFirstOfReply: true },
  })
  expect(await footer()).toBe('◆ Haiku 4.5 · low · 3s')

  // A table wider than the reply is drawn as a fitted grid.
  const wide = await $.ui.mount({
    surface: 'terminal',
    requestId: 'reply-3',
    plugin: 'prompt-timeline',
    component: 'AssistantMessage',
    props: { text: 'Before.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.', isFirstOfReply: true },
    viewport: { columns: 10, rows: 40 },
  })
  expect((await wide.find({ key: 'part-0' }))?.text).toContain('Before.')
  // Drawn as a grid: rounded border, column dividers, cells as text.
  expect(await wide.find({ text: /^╭─+┬─+╮$/ })).toBeDefined()
  expect(await wide.find({ type: 'Text', text: 'a' })).toBeDefined()
  expect(await wide.find({ type: 'Text', text: '2' })).toBeDefined()
  expect((await wide.find({ key: 'part-2' }))?.text).toContain('After.')
  await wide.unmount()
  // A table that fits keeps Claude Code's own table.
  const fits = await $.ui.mount({
    surface: 'terminal',
    requestId: 'reply-4',
    plugin: 'prompt-timeline',
    component: 'AssistantMessage',
    props: { text: '| a | b |\n| --- | --- |\n| 1 | 2 |', isFirstOfReply: true },
    viewport: { columns: 120, rows: 40 },
  })
  expect(await fits.find({ type: 'Markdown', text: /\| a \| b \|/ })).toBeDefined()
  expect(await fits.find({ text: /^╭/ })).toBeUndefined()
  await fits.unmount()
  await fresh.unmount()

  const notice = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'InfoNotice',
    props: { text: 'Continue your session in Claude Code Desktop', command: '/desktop' },
  })
  expect(await notice.find({ text: ' /desktop ' })).toBeDefined()
  await notice.unmount()
})

test('a Bash card leads with its description and shows the command as one dim line', async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  const row = (input: Record<string, string>, isErrored = false) =>
    ({
      plugin: 'prompt-timeline',
      component: 'ToolUse',
      requestId: 'b1',
      props: { tool_use_id: 'b1', tool: 'Bash', input, isRunning: false, isErrored, isInterrupted: false },
    }) as const

  for (const surface of ['terminal', 'desktop'] as const) {
    const card = await $.ui.mount({ surface, ...row({ command: 'cd x && npm test\necho done\necho again', description: 'Run the tests' }) })
    expect(await card.find({ text: 'Run the tests' })).toBeDefined()
    expect(await card.find({ text: 'Bash' })).toBeDefined()
    expect(await card.find({ text: 'x $ npm test  (+2 lines)' })).toBeDefined()
    await card.unmount()

    const bare = await $.ui.mount({ surface, ...row({ command: 'ls' }) })
    expect(await bare.find({ text: '$ ls' })).toBeDefined()
    await bare.unmount()
    const reindex = await $.ui.mount({ surface, ...row({ command: 'node build-semantic-index.cjs .', description: 'Rebuild' }) })
    expect(await reindex.find({ text: 'engine row' })).toBeDefined()
    await reindex.unmount()
  }
})

test('a screenshot returned in a grouped row is drawn under its card in the terminal and opens large', async ($, on) => {
  const opened: unknown[] = []
  on('ui.open', (_, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const props = {
    tool_use_id: 's1',
    tool: 'mcp__plugin_dev-core_chrome-devtools__take_screenshot',
    input: { pageId: 2 },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    output: [{ type: 'text', text: 'Took a screenshot.' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }],
  }

  const terminal = await $.ui.mount({ plugin: 'prompt-timeline', surface: 'terminal', component: 'ToolUse', requestId: 's1', props })
  expect(await terminal.find({ text: 'Screenshot' })).toBeDefined()
  expect(await terminal.find({ type: 'Image' })).toBeDefined()
  await terminal.press({ key: 'enlarge-s1' })
  expect(opened).toEqual([expect.objectContaining({ id: 'screenshot', focus: true, closeOnEscape: true })])
  await terminal.unmount()

  const pane = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'screenshot',
    props: { title: 'Screenshot', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await pane.find({ type: 'Image' })).toBeDefined()
  await pane.unmount()

  const desktop = await $.ui.mount({ plugin: 'prompt-timeline', surface: 'desktop', component: 'ToolUse', requestId: 's1', props })
  expect(await desktop.find({ type: 'Image' })).toBeUndefined()
  await desktop.unmount()
})

test('a call that sends text shows it as markdown, folded after eight lines', async $ => {
  const content = ['`useQuery` must be **on**.', ...Array.from({ length: 10 }, (_, i) => `line ${i + 2}`)].join('\n')
  const card = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'm1',
    props: {
      tool_use_id: 'm1',
      tool: 'mcp__ado__repo_pull_request_thread_write',
      input: { action: 'create', pullRequestId: 6179, content },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
  })
  expect(await card.find({ type: 'Markdown', text: /^`useQuery` must be \*\*on\*\*\.\nline 2/ })).toBeDefined()
  expect(await card.find({ text: '… 3 more lines' })).toBeDefined()
  await card.unmount()
})

test('short Bash output sits under its card, with stderr in red', async $ => {
  const stdout = ['\x1b[32mok\x1b[0m', 'row 2', '[see remaining: tail -n +1 "/x/tee.log"]'].join('\n')
  const result = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'r1',
    props: { tool_use_id: 'r1', tool: 'Bash', output: { stdout, stderr: 'warning: slow' }, isErrored: false },
  })
  expect(await result.find({ text: 'ok' })).toBeDefined()
  expect(await result.find({ text: /see remaining/ })).toBeUndefined()
  expect(await result.find({ text: 'warning: slow' })).toBeDefined()
  await result.unmount()
})

test('long Bash output goes to Claude Code, so details can unfold it; changed files keep their diff', async ($, on) => {
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`engine row${(e.props.output as { bashEditDiff?: unknown }).bashEditDiff ? ' with diff' : ''}`}</Text>
  })
  const stdout = Array.from({ length: 15 }, (_, i) => `row ${i + 1}`).join('\n')
  const bashEditDiff = { files: [{ filePath: '/r/a.json', hunks: [{ oldStart: 1, newStart: 1, lines: ['-1', '+2'] }] }] }
  const result = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'r3',
    props: { tool_use_id: 'r3', tool: 'Bash', output: { stdout, stderr: '', bashEditDiff }, isErrored: false },
  })
  expect(await result.find({ text: 'engine row' })).toBeDefined()
  expect(await result.find({ text: 'a.json' })).toBeDefined()
  expect(await result.find({ text: 'row 1' })).toBeUndefined()
  await result.unmount()
})

test('a printed diff in short output goes to the highlighter', async $ => {
  const stdout = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,1 +1,1 @@', '-old', '+new'].join('\n')
  const result = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'r4',
    props: { tool_use_id: 'r4', tool: 'Bash', output: { stdout, stderr: '' }, isErrored: false },
  })
  expect(await result.find({ text: 'diff --git a/src/a.ts b/src/a.ts' })).toBeDefined()
  const code = await result.find({ type: 'Code' })
  expect(code?.text).toBe('@@ -1,1 +1,1 @@\n-old\n+new')
  expect(code?.props.path).toBe('src/a.ts')
  await result.unmount()
})

test('files a Bash command changed show as a diff under its output', async $ => {
  const bashEditDiff = {
    files: [{ filePath: '/Users/me/repo/plugin.json', hunks: [{ oldStart: 2, newStart: 2, lines: [' "name": "x",', '-"version": "0.1.0",', '+"version": "0.1.1",'] }] }],
  }
  const result = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'r2',
    props: { tool_use_id: 'r2', tool: 'Bash', output: { stdout: '', stderr: '', bashEditDiff }, isErrored: false },
  })
  expect(await result.find({ text: 'plugin.json' })).toBeDefined()
  expect(await result.find({ text: '~/repo/' })).toBeDefined()
  expect(await result.find({ text: ' +1 ' })).toBeDefined()
  expect(await result.find({ text: ' −1 ' })).toBeDefined()
  // Claude Code's highlighter draws the hunk, so syntax colours come from the path.
  expect((await result.find({ type: 'Code' }))?.text).toBe('@@ -2,2 +2,2 @@\n "name": "x",\n-"version": "0.1.0",\n+"version": "0.1.1",')
  expect(await result.find({ text: '(no output)' })).toBeUndefined()
  await result.unmount()
})

test('rows of an expanded group show their result inline, as Claude Code does', async ($, on) => {
  on('ui.render', { component: 'ToolGroup' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine group</Text>
  })
  const calls = [
    { tool_use_id: 'g1', tool: 'Read', input: { file_path: '/r/a.ts' }, isRunning: false, isErrored: false, isInterrupted: false },
    { tool_use_id: 'g2', tool: 'Bash', input: { command: 'ls', description: 'List' }, isRunning: false, isErrored: false, isInterrupted: false },
  ]
  const group = await $.ui.mount({ plugin: 'prompt-timeline', surface: 'terminal', component: 'ToolGroup', requestId: 'grp', props: { calls, isActive: false, isExpanded: true } })
  await group.unmount()
  const row = (id: string, tool: string, input: Record<string, string>, output: unknown) =>
    ({ plugin: 'prompt-timeline', surface: 'terminal', component: 'ToolUse', requestId: id, props: { tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false, output } }) as const

  const read = await $.ui.mount(row('g1', 'Read', { file_path: '/r/a.ts' }, { type: 'text', file: { numLines: 40, totalLines: 120 } }))
  expect(await read.find({ text: '↳ 40 of 120 lines' })).toBeDefined()
  await read.unmount()
  const bash = await $.ui.mount(row('g2', 'Bash', { command: 'ls', description: 'List' }, { stdout: 'a.ts\nb.ts', stderr: '' }))
  expect(await bash.find({ text: 'b.ts' })).toBeDefined()
  await bash.unmount()
  // A row outside any group leaves its result to the ToolResult row.
  const alone = await $.ui.mount(row('s9', 'Read', { file_path: '/r/a.ts' }, { type: 'text', file: { numLines: 40, totalLines: 40 } }))
  expect(await alone.find({ text: /↳/ })).toBeUndefined()
  await alone.unmount()
})

test('grouped MCP rows keep their result lines: every find_docs hit, and a count for what a long result leaves out', async ($, on) => {
  on('ui.render', { component: 'ToolGroup' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine group</Text>
  })
  const docs = 'mcp__plugin_repo-docs_repo-docs__find_docs'
  const other = 'mcp__plugin_ado_ado__list_items'
  const read = 'mcp__plugin_repo-docs_repo-docs__read_doc'
  const calls = [docs, other, read].map((tool, i) => ({ tool_use_id: `m${i}`, tool, input: { query: 'cache' }, isRunning: false, isErrored: false, isInterrupted: false }))
  const group = await $.ui.mount({ plugin: 'prompt-timeline', surface: 'terminal', component: 'ToolGroup', requestId: 'mgrp', props: { calls, isActive: false, isExpanded: true } })
  await group.unmount()
  const row = (id: string, tool: string, text: string) =>
    ({ plugin: 'prompt-timeline', surface: 'terminal', component: 'ToolUse', requestId: id, props: { tool_use_id: id, tool, input: { query: 'cache' }, isRunning: false, isErrored: false, isInterrupted: false, output: [{ type: 'text', text }] } }) as const

  const hits = Array.from({ length: 12 }, (_, i) => `${i + 1}) docs/d${i + 1}.md:${i + 1} › Heading ${i + 1} — snippet`)
  const found = await $.ui.mount(row('m0', docs, ['docs "cache"', ...hits].join('\n')))
  expect(await found.find({ text: '↳ docs "cache"' })).toBeDefined()
  expect(await found.find({ text: '  1) docs/d1.md:1 › Heading 1 — snippet' })).toBeDefined()
  expect(await found.find({ text: '  12) docs/d12.md:12 › Heading 12 — snippet' })).toBeDefined()
  await found.unmount()
  const long = await $.ui.mount(row('m1', other, Array.from({ length: 20 }, (_, i) => `item ${i + 1}`).join('\n')))
  expect(await long.find({ text: '  item 8' })).toBeDefined()
  expect(await long.find({ text: '  item 9' })).toBeUndefined()
  expect(await long.find({ text: '  … +12 more lines' })).toBeDefined()
  await long.unmount()
  const doc = await $.ui.mount(row('m2', read, '# Title\n\nBody\n'))
  expect(await doc.find({ text: '↳ 4 lines' })).toBeDefined()
  await doc.unmount()
})

test('Bash output colours outcomes and draws rg matches with a gutter and highlighting', async $ => {
  const stdout = ['hooks/look.tsx:138:    <Box flexDirection="column">', '172:  return x', '✔ Validation passed', ' 18 pass', ' 2 fail'].join('\n')
  const result = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'r3',
    props: { tool_use_id: 'r3', tool: 'Bash', output: { stdout, stderr: '' }, isErrored: false },
  })
  expect(await result.find({ text: 'hooks/look.tsx:138' })).toBeDefined()
  expect((await result.find({ type: 'Code' }))?.text).toBe('    <Box flexDirection="column">')
  expect(await result.find({ text: ' 172' })).toBeDefined()
  expect(await result.find({ text: '  return x' })).toBeDefined()
  expect(await result.find({ text: '✔ Validation passed' })).toBeDefined()
  await result.unmount()
})

test('an inline script is found with its language', () => {
  expect(scriptOf("python3 - <<'PY'\nprint(1)\nPY")).toEqual({ source: 'print(1)', language: 'python' })
  expect(scriptOf('cd /r && node -e "console.log(1)"')).toEqual({ source: 'console.log(1)', language: 'javascript' })
  expect(scriptOf("cat > /r/a.ts <<'EOF'\nexport const a = 1\nEOF")).toEqual({ source: 'export const a = 1', path: '/r/a.ts' })
  expect(scriptOf('git status')).toBeNull()
})

test('a script run shows its code numbered, then its output', async $ => {
  const command = "node - <<'JS'\nconst r = [1]\nconsole.log(JSON.stringify(r))\nJS"
  const use = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'x1',
    props: { tool_use_id: 'x1', tool: 'Bash', input: { command, description: 'Run it' }, isRunning: false, isErrored: false, isInterrupted: false },
  })
  await use.unmount()
  const result = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'x1',
    props: { tool_use_id: 'x1', tool: 'Bash', output: { stdout: '[1]', stderr: '' }, isErrored: false },
  })
  const codes = await result.findAll({ type: 'Code' })
  expect(codes.map(code => [code.text, code.props.language, code.props.startLine])).toEqual([
    ['const r = [1]\nconsole.log(JSON.stringify(r))', 'javascript', 1],
    ['[1]', 'json', 1],
  ])
  expect(await result.find({ text: 'Output' })).toBeDefined()
  await result.unmount()
})
