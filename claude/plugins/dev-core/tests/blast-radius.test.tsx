import { expect, test } from 'claude-code/testing'

import { riskyPart } from '../hooks/blast-radius'

test('destructive commands are recognised, everyday ones are not', () => {
  expect(riskyPart('cd repo && rm -rf dist')?.kind).toBe('rm -r')
  expect(riskyPart('git reset --hard HEAD~1')?.kind).toBe('git reset --hard')
  expect(riskyPart('git clean -fd')?.kind).toBe('git clean')
  expect(riskyPart('git push --force origin main')?.kind).toBe('force push')
  expect(riskyPart('npx prisma migrate reset')?.kind).toBe('migration')
  expect(riskyPart('rm notes.txt')).toBeNull()
  expect(riskyPart('git push origin main')).toBeNull()
  expect(riskyPart('git clean -n')).toBeNull()
})

const OK = { value: { exitCode: 0, stdout: ' M src/a.ts\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }

test('a held command runs on Allow and is refused on Block, after showing what it removes', async ($, on) => {
  const ran: string[] = []
  const asked: string[] = []
  let reply = 'Allow'
  on('session.start', () => ({ cwd: '/repo' }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', () => OK)
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    ran.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    asked.push(String(e.questions[0]?.question))
    return { result: { questions: e.questions, answers: { [String(e.questions[0]?.question)]: reply } }, text: '' }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(asked[0]).toMatch(/Run this git reset --hard\?[\s\S]*lose changes: src\/a\.ts/)
  expect(ran).toEqual(['git reset --hard'])

  reply = 'Block'
  expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })).deny).toMatch(/blocked this rm -r/)
  expect(ran).toEqual(['git reset --hard'])
})

// A hook past its 10 s budget is skipped and the call runs on its behalf, so the wait must not count.
test('a held command still waits after the 10 s hook budget', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: string[] = []
  on('session.start', () => ({ cwd: '/repo' }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', () => OK)
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    ran.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, () => new Promise(() => {}))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  void $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  await new Promise(resolve => setTimeout(resolve, 11_000))
  expect(ran).toEqual([])
})
