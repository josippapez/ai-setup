import { expect, mock, test } from 'claude-code/testing'

test('shows the build percentage while the lock exists and toasts when it goes away', async ($, on) => {
  const clock = mock.clock(on)
  let isLocked = true
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  let progress = '12 48'
  on('fs.exists', (_, e) => ({ value: isLocked && /index-build\.(lock|progress)$/.test(e.path) }))
  on('fs.read', () => ({ value: progress }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  on('session.start', () => ({ cwd: '/repo' }))
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  expect(statuses).toEqual(['indexing docs 25% (12/48)'])

  progress = '36 48'
  await clock.advance(3000)
  expect(statuses.at(-1)).toBe('indexing docs 75% (36/48)')

  isLocked = false
  await clock.advance(3000)
  expect(statuses.at(-1)).toBeUndefined()
  expect(toasts).toEqual(['repo-docs: doc index updated'])
})
