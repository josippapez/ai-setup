import { describe, expect, test } from 'claude-code/testing'

import { contentOf, hintFor, labelFor, previewLines, rowsFor } from '../hooks/register'

const props = (isExpanded: boolean) => ({
  isActive: false,
  isExpanded,
  calls: [
    { tool: 'Grep', input: { pattern: 'TODO', path: '/repo/src' }, isRunning: false, isErrored: false, isInterrupted: false },
    { tool: 'Bash', input: { command: 'git status\necho hi' }, isRunning: false, isErrored: false, isInterrupted: false },
  ],
})

describe('tool group hints', () => {
  test('a folded group shows one hint per call', async ($, on) => {
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['Searched for 1 pattern, ran 1 shell command'] }) as never)
    on('session.cwd', () => ({ value: '/repo' }))
    const ui = await $.ui.mount({ plugin: 'tool-group-hints', surface: 'terminal', component: 'ToolGroup', requestId: 'g1', props: props(false) })
    expect(await ui.find({ type: 'Text', text: /Search "TODO" in src/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Ran git status$/ })).toBeDefined()
    await ui.unmount()
  })

  test('an expanded group is left to the engine', async ($, on) => {
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['Searched for 1 pattern, ran 1 shell command'] }) as never)
    on('session.cwd', () => ({ value: '/repo' }))
    const ui = await $.ui.mount({ plugin: 'tool-group-hints', surface: 'terminal', component: 'ToolGroup', requestId: 'g2', props: props(true) })
    expect(await ui.find({ type: 'Text', text: /TODO/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('hint text', () => {
  test('MCP calls show server, tool and their short arguments', async () => {
    const call = { tool: 'mcp__ado__wit_get_work_item', input: { id: 1234, project: 'Web', expand: { all: true } }, isRunning: false, isErrored: false, isInterrupted: false }
    expect(labelFor(call.tool)).toBe('ado › wit_get_work_item')
    expect(hintFor(call)).toBe('ado › wit_get_work_item id=1234')
  })
})

describe('hints seen in real transcripts', () => {
  const call = (tool: string, input: unknown) => ({ tool, input, isRunning: false, isErrored: false, isInterrupted: false })

  test('a leading cd is dropped from shell commands', () => {
    expect(hintFor(call('Bash', { command: 'cd /repo && rg -n foo' }))).toBe('Ran rg -n foo')
    expect(hintFor(call('Bash', { command: 'cd /repo; git status' }))).toBe('Ran git status')
  })

  test('same-every-time arguments are skipped and action leads', () => {
    expect(hintFor(call('mcp__ado__wit_work_item', { action: 'get', id: 106038, project: 'SciQ', fields: ['a', 'b'] }))).toBe('ado › wit_work_item get id=106038 fields=[2]')
    expect(hintFor(call('mcp__chrome-devtools__navigate_page', { pageId: 1, type: 'url', url: 'http://localhost:4300' }))).toBe('chrome-devtools › navigate_page type=url url=http://localhost:4300')
  })

  test('plugin MCP servers show by server name', () => {
    expect(labelFor('mcp__plugin_repo-docs_repo-docs__find_docs')).toBe('repo-docs › find_docs')
  })
})

describe('content preview', () => {
  const done = (tool: string, input: unknown, output: unknown) => ({ tool, input, output, isRunning: false, isErrored: false, isInterrupted: false })

  test('a Read shows its size and lines', () => {
    const read = done('Read', { file_path: '/repo/a.md' }, { type: 'text', file: { filePath: '/repo/a.md', content: '# A\nbody', numLines: 2, startLine: 1, totalLines: 40 } })
    expect(contentOf(read)).toEqual({ size: '2 lines', lines: ['# A', 'body'] })
  })

  test('a Bash shows its stdout, or says it had none', () => {
    expect(contentOf(done('Bash', { command: 'cat a' }, { stdout: 'x\ny\n', stderr: '', interrupted: false }))).toEqual({ size: '2 lines', lines: ['x', 'y'] })
    expect(contentOf(done('Bash', { command: 'cat >> a' }, { stdout: '', stderr: '', interrupted: false }))).toEqual({ size: 'no output', lines: [] })
  })

  test('a silent heredoc shows what it wrote', () => {
    const command = "cat >> log.md <<'EOF'\n\n## 2026-10-06\n- event\nEOF"
    expect(contentOf(done('Bash', { command }, { stdout: '', stderr: '', interrupted: false }))).toEqual({ size: 'no output, wrote 3 lines', lines: ['## 2026-10-06', '- event'] })
  })

  test('the folded group draws the first lines under the hint', async ($, on) => {
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['Read 1 file'] }) as never)
    on('session.cwd', () => ({ value: '/repo' }))
    const calls = [done('Read', { file_path: '/repo/a.md' }, { type: 'text', file: { filePath: '/repo/a.md', content: '## 2026-10-06\n- event', numLines: 2, startLine: 1, totalLines: 2 } })]
    const ui = await $.ui.mount({ plugin: 'tool-group-hints', surface: 'terminal', component: 'ToolGroup', requestId: 'g3', props: { isActive: false, isExpanded: false, calls } })
    expect(await ui.find({ type: 'Text', text: /Read a\.md {2}· 2 lines/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /│ ## 2026-10-06/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('Codex and Pi borrowed layout', () => {
  const ok = (tool: string, input: unknown, output?: unknown) => ({ tool, input, output, isRunning: false, isErrored: false, isInterrupted: false })

  test('back-to-back reads share one row, and other calls break the run', () => {
    const rows = rowsFor([ok('Read', { file_path: 'a.ts' }), ok('Read', { file_path: 'b.ts' }), ok('Grep', { pattern: 'x' }), ok('Read', { file_path: 'c.ts' })])
    expect(rows.map(r => r.text)).toEqual(['Read a.ts, b.ts', 'Search "x"', 'Read c.ts'])
  })

  test('a failed read keeps its own row', () => {
    const rows = rowsFor([ok('Read', { file_path: 'a.ts' }), { ...ok('Read', { file_path: 'b.ts' }), isErrored: true }])
    expect(rows.map(r => r.text)).toEqual(['Read a.ts', 'Read b.ts'])
  })

  test('a partial read names its line range', () => {
    const read = ok('Read', { file_path: 'a.ts' }, { type: 'text', file: { filePath: 'a.ts', content: 'x', numLines: 61, startLine: 120, totalLines: 340 } })
    expect(hintFor(read)).toBe('Read a.ts:120-180')
  })

  test('a running shell call says Running', () => {
    expect(hintFor({ ...ok('Bash', { command: 'sleep 5' }), isRunning: true })).toBe('Running sleep 5')
  })

  test('long previews keep head and tail around a count', () => {
    const lines = ['1', '2', '3', '4', '5', '6', '7']
    expect(previewLines(lines, 5)).toEqual(['1', '2', '… +3 lines', '6', '7'])
    expect(previewLines(lines, 2)).toEqual(['1', '… +6 lines'])
    expect(previewLines(['1', '2'], 5)).toEqual(['1', '2'])
  })

  test('the bullet is green for success and red for failure', async ($, on) => {
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['Ran 2 shell commands'] }) as never)
    on('session.cwd', () => ({ value: '/repo' }))
    const calls = [ok('Bash', { command: 'true' }), { ...ok('Bash', { command: 'false' }), isErrored: true }]
    const ui = await $.ui.mount({ plugin: 'tool-group-hints', surface: 'terminal', component: 'ToolGroup', requestId: 'g4', props: { isActive: false, isExpanded: false, calls } })
    const bullets = await ui.findAll({ type: 'Text', text: /^• $/ })
    expect(bullets.map(b => b.props?.color)).toEqual(['green', 'red'])
    await ui.unmount()
  })
})

describe('emphasis', () => {
  test('the verb is colored and bold, and a path stresses its file name', async ($, on) => {
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['Read 1 file'] }) as never)
    on('session.cwd', () => ({ value: '/repo' }))
    const calls = [{ tool: 'Read', input: { file_path: '/repo/hooks/look.tsx' }, isRunning: false, isErrored: false, isInterrupted: false }]
    const ui = await $.ui.mount({ plugin: 'tool-group-hints', surface: 'terminal', component: 'ToolGroup', requestId: 'g5', props: { isActive: false, isExpanded: false, calls } })
    const verbText = await ui.find({ type: 'Text', text: /^Read$/ })
    expect([verbText?.props?.color, verbText?.props?.bold]).toEqual(['blue', true])
    expect((await ui.find({ type: 'Text', text: /^look\.tsx$/ }))?.props?.bold).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^hooks\/$/ }))?.props?.dimColor).toBe(true)
    await ui.unmount()
  })
})
