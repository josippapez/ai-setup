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

const BAND = {
  plugin: 'dev-core',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const tick = () => Promise.resolve()

test('a held command runs on Allow and is refused on Block, after showing what it removes', async ($, on) => {
  const ran: string[] = []
  on('session.start', () => ({ cwd: '/repo' }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: ' M src/a.ts\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    ran.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const allowed = $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  for (let i = 0; i < 50; i += 1) await tick()
  const band = await $.ui.mount(BAND)
  expect(await band.find({ text: /Blast radius · git reset --hard/ })).toBeDefined()
  expect(await band.find({ text: /lose changes: src\/a\.ts/ })).toBeDefined()
  await band.press({ key: 'blast-allow' })
  await allowed
  expect(ran).toEqual(['git reset --hard'])
  await band.unmount()

  const blocked = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  for (let i = 0; i < 50; i += 1) await tick()
  const again = await $.ui.mount(BAND)
  await again.press({ key: 'blast-block' })
  expect((await blocked).deny).toMatch(/blocked this rm -r/)
  expect(ran).toEqual(['git reset --hard'])
  await again.unmount()
})
