import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register } from 'claude-code'

import type { Answer, Lesson, Offer, Question, Section, Verdict } from '../types'

const PANE = 'teach-back'
const TOOL = 'mcp__teach-back__lesson'
const KEEP = 30

// Change the tag when Lesson's fields change: it declines what an earlier version stored.
const lessons = atom({ plugin: 'teach-back', key: 'lessons' } as const, [] as Lesson[], { shape: 'lessons-1' })
const current = atom({ plugin: 'teach-back', key: 'current' } as const, null as string | null)
const step = atom({ plugin: 'teach-back', key: 'step' } as const, 0)
const preparing = atom({ plugin: 'teach-back', key: 'preparing' } as const, false)
const offer = atom({ plugin: 'teach-back', key: 'offer' } as const, null as Offer | null)
const project = atom({ plugin: 'teach-back', key: 'project' } as const, '')

const SCHEMA = {
  type: 'object',
  required: ['title', 'summary', 'sections', 'questions'],
  properties: {
    title: { type: 'string', description: 'What the lesson is about, under 70 characters.' },
    ask: { type: 'string', description: 'What the person or the ticket asked for, in one line.' },
    summary: { type: 'string', description: 'Two or three plain sentences for someone who was not there: the problem, the idea behind the solution, and the result.' },
    sections: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        required: ['heading', 'body'],
        properties: {
          heading: { type: 'string' },
          body: { type: 'string', description: 'Markdown, two to six short plain sentences.' },
          why: { type: 'string', description: 'Why it was done this way: the alternative that lost, and why it lost.' },
          files: { type: 'array', items: { type: 'string' }, description: 'Repo-relative paths, on sections about the code.' },
          code: {
            type: 'object',
            required: ['source'],
            properties: {
              path: { type: 'string' },
              language: { type: 'string' },
              source: { type: 'string', description: 'At most 25 lines.' },
              isDiff: { type: 'boolean', description: 'source is a unified diff hunk with its @@ header.' },
            },
          },
        },
      },
    },
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        required: ['kind', 'prompt'],
        properties: {
          kind: { enum: ['choice', 'explain'] },
          prompt: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, description: 'choice: three or four options.' },
          answer: { type: 'integer', description: 'choice: 0-based index of the right option.' },
          explain: { type: 'string', description: 'choice: why the right one is right and the most tempting wrong one is wrong.' },
          modelAnswer: { type: 'string', description: 'explain: a two to four sentence answer that passes.' },
          rubric: { type: 'string', description: 'explain: the two or three points a right answer must hit.' },
          section: { type: 'integer', description: '0-based index of the section this question checks.' },
        },
      },
    },
  },
}

type LessonInput = Pick<Lesson, 'title' | 'ask' | 'summary' | 'sections' | 'questions'>

// The model writes the input, so check what the pane relies on before storing it.
export function problemsOf(input: LessonInput): string[] {
  const problems: string[] = []
  input.questions.forEach((q, i) => {
    const at = `questions[${i}]`
    if (q.kind === 'choice') {
      if (!Array.isArray(q.options) || q.options.length < 2) problems.push(`${at}: a choice needs at least two options`)
      else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) problems.push(`${at}: answer is not an index into options`)
      if (!q.explain) problems.push(`${at}: a choice needs explain`)
    } else if (q.kind === 'explain') {
      if (!q.modelAnswer || !q.rubric) problems.push(`${at}: an explain question needs modelAnswer and rubric`)
    } else problems.push(`${at}: kind is choice or explain`)
    if (q.section !== undefined && (q.section < 0 || q.section >= input.sections.length)) problems.push(`${at}: section is not an index into sections`)
  })

  return problems
}

export function verdictOf(q: Question, a: Answer | null): Verdict | 'skipped' | 'pending' {
  if (!a) return 'skipped'
  if (q.kind === 'choice') return a.picked === q.answer ? 'right' : 'wrong'

  return a.verdict ?? 'pending'
}

export function scoreOf(lesson: Lesson) {
  const points = lesson.questions.reduce((sum, q, i) => {
    const v = verdictOf(q, lesson.answers[i] ?? null)
    return sum + (v === 'right' ? 1 : v === 'partly' ? 0.5 : 0)
  }, 0)

  return { points, of: lesson.questions.length }
}

// The grader's reply is model text: take the first JSON object in it, or nothing.
export function parseGrade(text: string): { verdict: Verdict; feedback: string } | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const { verdict, feedback } = JSON.parse(match[0])
    if (!['right', 'partly', 'wrong'].includes(verdict) || typeof feedback !== 'string') return null
    return { verdict, feedback }
  } catch {
    return null
  }
}

async function grade($: EngineInterface, q: Extract<Question, { kind: 'explain' }>, text: string): Promise<Answer> {
  const r = await $.model.complete({
    model: 'haiku',
    maxTokens: 400,
    timeoutMs: 30_000,
    system:
      'You grade a developer explaining back a code change they did not write. Be fair and brief. ' +
      'right: hits every rubric point. partly: hits some. wrong: misses them or is mistaken. ' +
      'feedback: one or two plain sentences, naming what was missed or wrong. ' +
      'Reply with JSON only: {"verdict":"right"|"partly"|"wrong","feedback":"..."}',
    prompt: `Question: ${q.prompt}\n\nRubric:\n${q.rubric}\n\nReference answer:\n${q.modelAnswer}\n\nTheir answer:\n${text}`,
  })
  const graded = r.isAnswered ? parseGrade(r.text) : null

  // No grade: the pane shows the reference answer and lets them mark it themselves.
  return graded ? { text, ...graded } : { text }
}

async function saveAll($: EngineInterface, fn: (list: Lesson[]) => Lesson[]) {
  await update($, lessons, list => fn(list).slice(0, KEEP))
  await $.store.set('lessons', await read($, lessons))
}

const saveLesson = ($: EngineInterface, id: string, fn: (lesson: Lesson) => Lesson) =>
  saveAll($, list => list.map(one => (one.id === id ? fn(one) : one)))

const answerAt = ($: EngineInterface, id: string, i: number, answer: Answer | null) =>
  saveLesson($, id, lesson => ({ ...lesson, answers: lesson.questions.map((_, j) => (j === i ? answer : lesson.answers[j] ?? null)) }))

async function openPane($: EngineInterface) {
  const placed = await $.ui.open({ id: PANE, title: 'Teach-back', focus: true })
  if (!placed.isPlaced) $.ui.toast('Teach-back: this surface draws no panes. Open a terminal session and run /lessons.')
}

async function openLesson($: EngineInterface, lesson: Lesson) {
  await update($, current, () => lesson.id)
  const started = lesson.answers.some(Boolean)
  await update($, step, () => (started ? lesson.sections.length + lesson.questions.length : 0))
}

async function requestLesson($: EngineInterface, focus: string) {
  await update($, offer, () => null)
  await update($, current, () => null)
  await update($, preparing, () => true)
  // A press on the band holds the keys until the band is gone, and the pane wants them.
  await $.clock.sleep(200)
  await openPane($)
  const text =
    `Teach back the work done in this session${focus ? `, focusing on: ${focus}` : ''}. ` +
    `Use the teach-back:lesson skill: teach the task, the idea behind the solution and where it lives in the code, then deliver it with the ${TOOL} tool.`
  // The queued prompt starts once this dispatch is over, so don't hold the dispatch for it.
  $.clock.after(0, () => void $.prompt.submit({ text }))
}

// What git says changed, per file: numstat counts for tracked files, '?' for untracked ones.
type Snap = { head: string; files: Map<string, string> }

async function snapshot($: EngineInterface): Promise<Snap | null> {
  const head = await $.process.run(['git', 'rev-parse', 'HEAD'])
  if (head.exitCode !== 0) return null
  const files = new Map<string, string>()
  const num = await $.process.run(['git', 'diff', 'HEAD', '--numstat'])
  for (const line of num.stdout.split('\n').filter(Boolean)) {
    const [added, removed, ...path] = line.split('\t')
    files.set(path.join('\t'), `${added}/${removed}`)
  }
  const status = await $.process.run(['git', 'status', '--porcelain', '--untracked-files=all'])
  for (const line of status.stdout.split('\n')) if (line.startsWith('?? ')) files.set(line.slice(3), '?')

  return { head: head.stdout.trim(), files }
}

export async function changedSince($: EngineInterface, before: Snap, after: Snap) {
  const changed = new Set<string>()
  for (const path of new Set([...before.files.keys(), ...after.files.keys()])) if (before.files.get(path) !== after.files.get(path)) changed.add(path)
  if (before.head !== after.head) {
    const committed = await $.process.run(['git', 'diff', '--name-only', before.head, after.head])
    for (const path of committed.stdout.split('\n').filter(Boolean)) changed.add(path)
  }

  return changed
}

const VERDICT_MARK = { right: '✓ Right', partly: '◐ Partly', wrong: '✗ Not quite', skipped: '– Skipped', pending: '… Grading' }
const VERDICT_COLOR = { right: 'green', partly: 'yellow', wrong: 'red', skipped: 'gray', pending: 'gray' }

function listView($: EngineInterface, ui: ElementTable, list: Lesson[], isPreparing: boolean, here: string) {
  const { Box, Button, Text } = ui
  const mine = list.filter(one => one.project === here)
  const others = list.filter(one => one.project !== here)
  const row = (one: Lesson) => {
    const { points, of } = scoreOf(one)
    const done = one.answers.some(Boolean)
    return (
      <Button key={`open-${one.id}`} plain onPress={() => openLesson($, one)}>
        {one.title} <Text dimColor>· {one.createdAt.slice(0, 10)} · {done ? `${points}/${of}` : 'not taken'}</Text>
      </Button>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Text bold>Teach-back</Text>
      {isPreparing ? (
        <Text color="cyan">Preparing a lesson on this session's work…</Text>
      ) : (
        <Button key="teach-me" variant="primary" hotkey="t" label="Teach me this session's work" onPress={() => requestLesson($, '')} />
      )}
      {mine.length === 0 && others.length === 0 && <Text dimColor>No lessons yet. After the agent finishes a task, press Teach me.</Text>}
      {mine.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>This project</Text>
          {mine.map(row)}
        </Box>
      )}
      {others.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>Other projects</Text>
          {others.map(row)}
        </Box>
      )}
    </Box>
  )
}

function sectionCard($: EngineInterface, ui: ElementTable, lesson: Lesson, s: Section, i: number) {
  const { Box, Button, Code, Markdown, Text } = ui

  return (
    <Box flexDirection="column" gap={1}>
      {i === 0 && lesson.ask && <Text dimColor>Asked: {lesson.ask}</Text>}
      {i === 0 && <Text italic>{lesson.summary}</Text>}
      <Text bold color="cyan">
        {s.heading}
      </Text>
      <Markdown text={s.body} />
      {s.why && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text bold color="yellow">
            Why this way
          </Text>
          <Text wrap="wrap">{s.why}</Text>
        </Box>
      )}
      {s.code && <Code source={s.code.source} language={s.code.isDiff ? 'diff' : s.code.language} path={s.code.path} format={s.code.isDiff ? 'diff' : undefined} />}
      {s.files && s.files.length > 0 && <Text dimColor>Files: {s.files.join(', ')}</Text>}
      <Button
        key={`ask-${i}`}
        plain
        hotkey="a"
        label="Ask about this"
        onPress={async () => {
          const filled = await $.prompt.fill({ text: `About "${s.heading}" from the teach-back lesson: `, mode: 'replace' })
          if (!filled.isFilled) $.ui.toast(`Ask in the prompt about "${s.heading}".`)
        }}
      />
    </Box>
  )
}

function questionCard($: EngineInterface, ui: ElementTable, lesson: Lesson, q: Question, i: number) {
  const { Box, Button, Input, Markdown, Text } = ui
  const a = lesson.answers[i] ?? null
  const v = verdictOf(q, a)
  const review =
    q.section !== undefined && a ? (
      <Button key={`review-${i}`} plain hotkey="l" label="See the lesson part" onPress={() => update($, step, () => q.section ?? 0)} />
    ) : null

  if (q.kind === 'choice') {
    return (
      <Box flexDirection="column" gap={1}>
        <Markdown text={q.prompt} />
        {q.options.map((option, o) =>
          a ? (
            <Text color={o === q.answer ? 'green' : o === a.picked ? 'red' : undefined} dimColor={o !== q.answer && o !== a.picked}>
              {o === q.answer ? '✓' : o === a.picked ? '✗' : ' '} {option}
            </Text>
          ) : (
            <Button key={`pick-${i}-${o}`} plain hotkey={String(o + 1)} label={`${o + 1}. ${option}`} onPress={() => answerAt($, lesson.id, i, { picked: o })} />
          ),
        )}
        {a && (
          <Box flexDirection="column" borderStyle="round" borderColor={VERDICT_COLOR[v]} paddingX={1}>
            <Text bold color={VERDICT_COLOR[v]}>
              {VERDICT_MARK[v]}
            </Text>
            <Text wrap="wrap">{q.explain}</Text>
          </Box>
        )}
        {review}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Markdown text={q.prompt} />
      {!a && (
        <Input
          key={`explain-${i}`}
          placeholder="Explain it in your own words, then press Enter"
          rows={3}
          onSubmit={async value => {
            const text = value.trim()
            if (!text) return
            await answerAt($, lesson.id, i, { text, isGrading: true })
            await answerAt($, lesson.id, i, await grade($, q, text))
          }}
        />
      )}
      {a && <Text dimColor wrap="wrap">You said: {a.text}</Text>}
      {a?.isGrading && <Text color="cyan">Grading…</Text>}
      {a && !a.isGrading && (
        <Box flexDirection="column" borderStyle="round" borderColor={VERDICT_COLOR[v]} paddingX={1}>
          {a.verdict ? (
            <Text bold color={VERDICT_COLOR[v]}>
              {VERDICT_MARK[v]}
            </Text>
          ) : (
            <Text bold>Compare with the answer below. Did you have it?</Text>
          )}
          {a.feedback && <Text wrap="wrap">{a.feedback}</Text>}
          <Text dimColor>A good answer:</Text>
          <Text wrap="wrap">{q.modelAnswer}</Text>
          {!a.verdict && (
            <Box gap={2}>
              <Button key={`self-right-${i}`} plain hotkey="y" label="I had it" onPress={() => answerAt($, lesson.id, i, { ...a, verdict: 'right' })} />
              <Button key={`self-partly-${i}`} plain hotkey="p" label="Partly" onPress={() => answerAt($, lesson.id, i, { ...a, verdict: 'partly' })} />
              <Button key={`self-wrong-${i}`} plain hotkey="m" label="I missed it" onPress={() => answerAt($, lesson.id, i, { ...a, verdict: 'wrong' })} />
            </Box>
          )}
        </Box>
      )}
      {review}
    </Box>
  )
}

function resultsCard($: EngineInterface, ui: ElementTable, lesson: Lesson) {
  const { Box, Button, Text } = ui
  const { points, of } = scoreOf(lesson)
  const S = lesson.sections.length
  const missed = lesson.questions.map((q, i) => ({ q, i, v: verdictOf(q, lesson.answers[i] ?? null) })).filter(one => one.v !== 'right')

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color={missed.length === 0 ? 'green' : 'yellow'}>
        {points} of {of} {missed.length === 0 ? '· you own this change' : ''}
      </Text>
      {missed.map(({ q, i, v }) => (
        <Button key={`missed-${i}`} plain onPress={() => update($, step, () => S + i)}>
          <Text color={VERDICT_COLOR[v]}>{VERDICT_MARK[v]}</Text> {q.prompt.length > 90 ? `${q.prompt.slice(0, 89)}…` : q.prompt}
        </Button>
      ))}
      <Box gap={2} flexWrap="wrap">
        {missed.length > 0 && (
          <Button
            key="retry-missed"
            variant="primary"
            hotkey="r"
            label="Retry the ones I missed"
            onPress={async () => {
              await saveLesson($, lesson.id, one => ({ ...one, answers: one.answers.map((a, i) => (missed.some(m => m.i === i) ? null : a)) }))
              await update($, step, () => S + (missed[0]?.i ?? 0))
            }}
          />
        )}
        <Button key="all-lessons" plain hotkey="h" label="All lessons" onPress={() => update($, current, () => null)} />
      </Box>
    </Box>
  )
}

function lessonView($: EngineInterface, ui: ElementTable, lesson: Lesson, at: number) {
  const { Box, Button, Progress, Text } = ui
  const S = lesson.sections.length
  const total = S + lesson.questions.length
  const here = Math.min(Math.max(0, at), total)
  const label = here < S ? `Lesson ${here + 1} of ${S}` : here < total ? `Question ${here - S + 1} of ${total - S}` : 'Results'
  const section = lesson.sections[here]
  const question = lesson.questions[here - S]
  const body = section ? sectionCard($, ui, lesson, section, here) : question ? questionCard($, ui, lesson, question, here - S) : resultsCard($, ui, lesson)
  const go = (to: number) => update($, step, () => to)

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Box justifyContent="space-between">
        <Text bold>{lesson.title}</Text>
        <Button key="back-to-list" plain role="dismiss" label="✕" onPress={() => update($, current, () => null)} />
      </Box>
      <Progress label={label} value={here} max={total} />
      {body}
      {here < total && (
        <Box gap={2}>
          {here > 0 && <Button key="prev" plain hotkey="b" label="← Back" onPress={() => go(here - 1)} />}
          <Button
            key="next"
            variant="primary"
            hotkey="n"
            label={here === S - 1 ? 'Start the quiz →' : here >= S && !lesson.answers[here - S] ? 'Skip →' : 'Next →'}
            onPress={() => go(here + 1)}
          />
        </Box>
      )}
    </Box>
  )
}

export const register: Register = on => {
  // Set at the main loop's turn.start, read at its turn.complete; a reload mid-turn costs one offer.
  let before: Promise<Snap | null> | null = null
  let isLessonTurn = false

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'lesson',
      isDeferred: false,
      inputSchema: SCHEMA,
      description:
        'Shows the person an interactive lesson and quiz on work done in this session, in the Teach-back pane: ' +
        'sections they read first (the problem, the idea behind the solution, why this way, where it lives in the code, what to take to the next task), then questions they answer. ' +
        'Load the teach-back:lesson skill before calling it: it says how to build a good lesson. Never write the lesson in chat instead.',
    })
    await $.command.register({ name: 'teach-back', description: "Get a lesson and quiz on this session's work", argumentHint: '[what to focus on]' })
    await $.command.register({ name: 'lessons', description: 'Open the Teach-back pane with past lessons' })
    const stored = await $.store.get('lessons')
    await update($, lessons, () => (Array.isArray(stored) ? (stored as Lesson[]) : []))
    const root = await $.session.root()
    await update($, project, () => root)

    return next(e)
  })

  on('tool.run', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as LessonInput
    const problems = problemsOf(input)
    if (problems.length > 0) return { deny: `Lesson not shown, fix and call again: ${problems.join('; ')}` }
    isLessonTurn = true
    const lesson: Lesson = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date(await $.clock.now()).toISOString(),
      project: await read($, project),
      title: input.title,
      ask: input.ask,
      summary: input.summary,
      sections: input.sections,
      questions: input.questions,
      answers: input.questions.map(() => null),
    }
    await saveAll($, list => [lesson, ...list])
    await update($, preparing, () => false)
    await update($, offer, () => null)
    await openLesson($, lesson)
    await openPane($)

    return { result: `Lesson "${lesson.title}" is open in the Teach-back pane: ${lesson.sections.length} parts, ${lesson.questions.length} questions. Tell the person in one line; don't repeat it in chat.` }
  })

  on('command.run', { command: 'teach-back' }, async ($, e) => {
    await requestLesson($, e.args.trim())

    return { text: 'Preparing a lesson in the Teach-back pane.' }
  })

  on('command.run', { command: 'lessons' }, async $ => {
    await update($, current, () => null)
    await openPane($)

    return { text: 'Teach-back pane opened.' }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      isLessonTurn = false
      // No git, or git that can't start: no button, never an unhandled rejection.
      before = snapshot($).catch(() => null)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || !before) return r
    const was = before
    before = null
    if (isLessonTurn) return r
    // git takes a moment on a big repo; the turn has ended, so don't hold it.
    $.clock.after(0, () =>
      void (async () => {
        const start = await was
        const end = start && (await snapshot($).catch(() => null))
        if (!start || !end) return
        const changed = await changedSince($, start, end)
        if (changed.size === 0 || (await read($, preparing))) return
        // The button stays until a lesson or Later, counting every file changed since.
        await update($, offer, prior => ({ files: [...new Set([...(prior?.files ?? []), ...changed])] }))
      })(),
    )

    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, offer)
    if (!shown) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box gap={2} paddingX={1}>
        <Text color="cyan">
          Teach-back: {shown.files.length} {shown.files.length === 1 ? 'file' : 'files'} changed since your last lesson.
        </Text>
        <Button key="offer-teach" label="Teach me" hotkey="t" onPress={() => requestLesson($, '')} />
        <Button key="offer-later" plain role="dismiss" label="Later" onPress={() => update($, offer, () => null)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const list = await read($, lessons)
    const id = await read($, current)
    const lesson = list.find(one => one.id === id)
    if (!lesson) return listView($, ui, list, await read($, preparing), await read($, project))

    return lessonView($, ui, lesson, await read($, step))
  })
}
