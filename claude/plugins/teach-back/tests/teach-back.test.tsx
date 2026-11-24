import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseGrade, problemsOf } from '../hooks/register'

const TOOL = 'mcp__teach-back__lesson'
const PANE = { title: 'Teach-back', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const BAND = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 5, bodyColumns: 60, scroll: { offset: 0, bodyRows: 5 }, view: {} } as const
const CHOICE = { kind: 'choice' as const, prompt: 'Where does the retry live?', options: ['In the job', 'In the API client', 'In the scheduler'], answer: 1, explain: 'The client, so every caller gets it.', section: 0 }
const EXPLAIN = { kind: 'explain' as const, prompt: 'Explain why the retry is capped.', modelAnswer: 'So a dead API fails fast.', rubric: 'Mentions the cap; mentions failing fast.', section: 0 }
const LESSON = {
  title: 'Retries for the sync job',
  ask: 'Make the nightly sync survive a flaky API',
  summary: 'The sync job now retries failed calls three times.',
  sections: [
    { heading: 'Where the retry lives', body: 'In the API client, not the job.', why: 'Every caller gets it; the job stays simple.', files: ['src/client.ts'] },
    { heading: 'How it is proven', body: 'A test fails the API twice and expects success.' },
  ],
  questions: [CHOICE, EXPLAIN],
}

function engine(on: On) {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-11-24T10:00:00Z') })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/x/ai-setup' }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  return clock
}

const start = ($: Engine) => $.session.start({ cwd: '/x/ai-setup', surface: 'desktop', isInteractive: true })
const mount = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'teach-back', component: 'Pane', requestId: 'teach-back', surface, props: PANE })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a lesson walks from its parts to the quiz to the score, on ${surface}`, async ($, on) => {
    engine(on)
    on('model.complete', () => ({
      value: { isAnswered: true, text: '{"verdict":"partly","feedback":"Missed failing fast."}', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    }))
    await start($)

    const ran = await $.tool.run({ tool: TOOL, tool_use_id: 't1', ...LESSON })
    expect(ran.result).toMatch(/is open in the Teach-back pane: 2 parts, 2 questions/)

    const ui = await mount($, surface)
    expect((await ui.find({ type: 'Text', text: 'Where the retry lives' }))?.text).toBe('Where the retry lives')
    expect(await ui.find({ type: 'Text', text: /Every caller gets it/ })).toBeDefined()

    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: 'How it is proven' })).toBeDefined()
    await ui.press({ key: 'next' })
    await ui.press({ key: 'pick-0-1' })
    expect(await ui.find({ type: 'Text', text: /✓ Right/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /every caller gets it/ })).toBeDefined()

    await ui.press({ key: 'next' })
    await ui.input({ key: 'explain-1', text: 'It stops after three tries.' })
    expect(await ui.find({ type: 'Text', text: /◐ Partly/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Missed failing fast.' })).toBeDefined()

    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /1\.5 of 2/ })).toBeDefined()
    await ui.press({ key: 'retry-missed' })
    expect(await ui.find({ type: 'Input', key: 'explain-1' })).toBeDefined()
    await ui.unmount()
  })
}

test('with no grade from the model, the person marks the answer themselves', async ($, on) => {
  engine(on)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 1, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  await start($)
  await $.tool.run({ tool: TOOL, tool_use_id: 't1', ...LESSON, questions: [EXPLAIN] })

  const ui = await mount($, 'desktop')
  await ui.press({ key: 'next' })
  await ui.press({ key: 'next' })
  await ui.input({ key: 'explain-0', text: 'No idea.' })
  expect(await ui.find({ type: 'Text', text: /Did you have it/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'So a dead API fails fast.' })).toBeDefined()

  await ui.press({ key: 'self-wrong-0' })
  expect(await ui.find({ type: 'Text', text: /✗ Not quite/ })).toBeDefined()
  await ui.unmount()
})

test('a lesson the pane cannot show is refused with what to fix', async ($, on) => {
  engine(on)
  await start($)

  const ran = await $.tool.run({ tool: TOOL, tool_use_id: 't1', ...LESSON, questions: [{ ...CHOICE, answer: 3 }] })

  expect(ran.deny).toBe('Lesson not shown, fix and call again: questions[0]: answer is not an index into options')
})

test('the Teach me button counts files changed since the last lesson, and Later hides it', async ($, on) => {
  const clock = engine(on)
  let turn = 0
  on('process.run', (_, e) => {
    const [, sub] = e.argv
    const stdout =
      sub === 'rev-parse' ? 'aaa\n' : sub === 'diff' && turn > 0 ? '3\t1\tsrc/a.ts\n' : sub === 'status' && turn > 0 ? ' M src/a.ts\n?? src/new.ts\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await start($)

  await $.turn.start({ text: 'fix the sync', turnId: 'u1' })
  await clock.settle()
  turn = 1
  await $.turn.complete({ turnId: 'u1', answer: 'done', durationMs: 1, isAborted: false, reason: 'answer' })
  await clock.settle()

  const band = await $.ui.mount({ plugin: 'teach-back', component: 'AbovePrompt', requestId: 'band', surface: 'desktop', props: BAND })
  expect(await band.find({ type: 'Text', text: /2 files changed since your last lesson/ })).toBeDefined()
  await band.press({ key: 'offer-later' })
  expect(await band.find({ type: 'Text', text: /files changed/ })).toBeUndefined()
  await band.unmount()
})

test('a grade is read from the first JSON object in the reply, or not at all', () => {
  expect(parseGrade('Sure: {"verdict":"right","feedback":"All there."}')).toEqual({ verdict: 'right', feedback: 'All there.' })
  expect(parseGrade('{"verdict":"great","feedback":"x"}')).toBeNull()
  expect(parseGrade('no json')).toBeNull()
  expect(problemsOf({ ...LESSON, questions: [{ kind: 'explain', prompt: 'p', modelAnswer: '', rubric: 'r' }] } as never)).toEqual([
    'questions[0]: an explain question needs modelAnswer and rubric',
  ])
})
