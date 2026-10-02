import { expect, test } from 'claude-code/testing'

const COMMAND = 'NODE_PATH="$MODULES" node "$BASE/cache/ai-setup/repo-docs/0.4.6/runtime/tools/build-semantic-index.cjs" "$ROOT"'
const STDOUT = 'repo_docs_index updated=3 unchanged=317 skipped=0 cache=/Users/me/Desktop/ai-setup/.claude/repo-docs/repo-docs-index.json\n'

test('the reindex command draws as a short summary row', async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine result</Text>
  })
  const use = (command: string) =>
    ({
      plugin: 'repo-docs',
      component: 'ToolUse',
      requestId: 'r1',
      props: { tool_use_id: 'r1', tool: 'Bash', input: { command }, isRunning: false, isErrored: false, isInterrupted: false },
    }) as const
  const result = (stdout: string) =>
    ({
      plugin: 'repo-docs',
      component: 'ToolResult',
      requestId: 'r1',
      props: { tool_use_id: 'r1', tool: 'Bash', output: { stdout, stderr: '' }, isErrored: false },
    }) as const

  for (const surface of ['terminal', 'desktop'] as const) {
    const row = await $.ui.mount({ surface, ...use(COMMAND) })
    expect(await row.find({ text: 'Reindex repo docs' })).toBeDefined()
    await row.unmount()

    const summary = await $.ui.mount({ surface, ...result(STDOUT) })
    expect(await summary.find({ text: '✓ ai-setup' })).toBeDefined()
    expect(await summary.find({ text: '3 re-embedded' })).toBeDefined()
    expect(await summary.find({ text: '317 unchanged' })).toBeDefined()
    expect(await summary.find({ text: /skipped/ })).toBeUndefined()
    await summary.unmount()

    const other = await $.ui.mount({ surface, ...use('ls -la') })
    expect(await other.find({ text: 'engine row' })).toBeDefined()
    await other.unmount()
    const plain = await $.ui.mount({ surface, ...result('hello\n') })
    expect(await plain.find({ text: 'engine result' })).toBeDefined()
    await plain.unmount()
  }
})
