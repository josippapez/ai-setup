import { expect, mock, test } from 'claude-code/testing'

const OK = { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
const DONE = { reason: 'answer', text: 'done', answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' } as const

test('a turn that touched a markdown file asks for one reindex when it ends', async ($, on) => {
  const clock = mock.clock(on)
  const runs: (readonly string[])[] = []
  on('tool.call', { tool: 'Bash' }, () => OK)
  on('session.cwd', () => ({ value: '/repo' }))
  on('turn.complete', () => ({ text: 'done' }))
  on('process.run', (_, e) => {
    runs.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.turn.complete(DONE)
  await clock.advance(1)
  expect(runs).toEqual([])

  await $.tool.call({ tool: 'Bash', command: "sed -i '' s/a/b/ README.md" })
  await $.tool.call({ tool: 'Bash', command: 'cat >> docs/guide.md <<EOF' })
  await $.turn.complete(DONE)
  await clock.advance(1)
  expect(runs.length).toBe(1)
  expect(runs[0]?.[1]).toContain('reindex-on-edit.cjs')
  expect(runs[0]?.slice(2)).toEqual(['--now', '/repo'])

  await $.turn.complete(DONE)
  await clock.advance(1)
  expect(runs.length).toBe(1)
})
