import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const TRIGGERS = JSON.stringify([
  { card: 'writing-code', tools: ['Edit', 'Write'] },
  { card: 'writing-code', tools: ['Bash'], fire: '(^|[\\s;&|])(sed\\s+-i|tee)\\b' },
  { card: 'searching', tools: ['Bash'], fire: '\\brg\\b', skip: '\\.md\\b' },
])
const CARDS: Record<string, string> = {
  'writing-code': '---\nname: writing-code\n---\n# Writing code\nKeep it small.',
  searching: '---\nname: searching\nrequires: .codegraph\n---\n# Before you grep\nAsk the graph.',
}
const OK = { result: { stdout: '', stderr: '', interrupted: false }, text: '' }

function stub(on: On, hasGraph: boolean) {
  on('session.start', () => ({ cwd: '/repo' }))
  on('fs.read', (_, e) => ({ value: e.path.endsWith('triggers.json') ? TRIGGERS : CARDS[e.path.split('/').pop()!.replace('.md', '')] ?? '' }))
  on('fs.exists', (_, e) => ({ value: hasGraph && e.path.endsWith('.codegraph') }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', { tool: 'Bash' }, () => OK)
}

test('a matching call carries its card once per two minutes', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, false)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })

  const first = await $.tool.call({ tool: 'Bash', command: "sed -i '' s/a/b/ f.js" })
  expect(first.context?.length).toBe(1)
  expect(first.context?.[0]).toContain('[rule-card] A dev-core rule')
  expect(first.context?.[0]).toContain('# Writing code')
  expect(first.context?.[0]).not.toContain('name: writing-code')

  const again = await $.tool.call({ tool: 'Bash', command: 'tee out.txt' })
  expect(again.context ?? []).toEqual([])

  await clock.advance(2 * 60 * 1000)
  const later = await $.tool.call({ tool: 'Bash', command: 'tee out.txt' })
  expect(later.context?.length).toBe(1)

  const plain = await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(plain.context ?? []).toEqual([])
})

test('requires and skip patterns keep a card out', async ($, on) => {
  mock.clock(on)
  stub(on, false)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  const noGraph = await $.tool.call({ tool: 'Bash', command: 'rg -n useAuth src/' })
  expect(noGraph.context ?? []).toEqual([])
})

test('the searching card fires with a graph present, but not on a markdown grep', async ($, on) => {
  mock.clock(on)
  stub(on, true)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  const docs = await $.tool.call({ tool: 'Bash', command: 'rg -n TODO README.md' })
  expect(docs.context ?? []).toEqual([])
  const code = await $.tool.call({ tool: 'Bash', command: 'rg -n useAuth src/' })
  expect(code.context?.[0]).toContain('# Before you grep')
})

test('a plain mv of a tracked file is denied with the git mv to run', async ($, on) => {
  mock.clock(on)
  on('session.start', () => ({ cwd: '/repo' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.read', () => ({ value: '[]' }))
  const gitDirs: string[] = []
  on('process.run', (_, e) => ({
    value: {
      exitCode: (gitDirs.push(e.argv[2] ?? ''), e.argv.includes('ls-files') && e.argv.at(-1) === 'untracked.txt') ? 1 : 0,
      stdout: e.argv.includes('rev-parse') ? 'true\n' : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('tool.call', { tool: 'Bash' }, () => OK)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })

  const tracked = await $.tool.call({ tool: 'Bash', command: 'mv src/a.js "src/b c.js" && echo done' })
  expect(tracked.deny).toContain("git mv src/a.js 'src/b c.js'")

  const untracked = await $.tool.call({ tool: 'Bash', command: 'mv untracked.txt other.txt' })
  expect(untracked.deny).toBeUndefined()
  const elsewhere = await $.tool.call({ tool: 'Bash', command: 'cd /other && mv untracked.txt b.txt' })
  expect(elsewhere.deny).toBeUndefined()
  expect(gitDirs.at(-1)).toBe('/other')
  const temp = await $.tool.call({ tool: 'Bash', command: 'mv /tmp/x.txt y.txt' })
  expect(temp.deny).toBeUndefined()
})
