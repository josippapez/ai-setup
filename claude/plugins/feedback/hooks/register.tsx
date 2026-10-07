import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry, Kind, Status, Warmup } from '../types'
import { registerTranscript } from './transcript'

const PANE = 'feedback'
const COLLECT = 'mcp__plugin_feedback_feedback__collect_feedback'
const UPDATE = 'mcp__plugin_feedback_feedback__update_feedback'
const SHOWS = [
  { show: 'open', label: 'Open', hotkey: 'o' },
  { show: 'resolved', label: 'Resolved', hotkey: 'r' },
  { show: 'wontfix', label: "Won't fix", hotkey: 'w' },
  { show: 'all', label: 'Everything', hotkey: 'e' },
] as const
const FILTERS = ['all', 'bug', 'pain_point', 'ambiguity', 'idea'] as const
const LABEL = { all: 'All', bug: 'Bug', pain_point: 'Pain point', ambiguity: 'Ambiguity', idea: 'Idea' }
const KIND_COLOR = { bug: 'red', pain_point: 'yellow', ambiguity: 'magenta', idea: 'cyan' }
const SEVERITY_COLOR = { high: 'red', medium: 'yellow', low: 'gray' }
const entries = atom({ plugin: 'feedback', key: 'entries' } as const, [])
const filter = atom({ plugin: 'feedback', key: 'filter' } as const, 'all' as Kind | 'all')
const justLogged = atom({ plugin: 'feedback', key: 'justLogged' } as const, null as Entry | null)
const show = atom({ plugin: 'feedback', key: 'show' } as const, 'open' as Status | 'all')
const secondsLeft = atom({ plugin: 'feedback', key: 'secondsLeft' } as const, 0)
const scope = atom({ plugin: 'feedback', key: 'scope' } as const, 'here' as 'here' | 'all')
const here = atom({ plugin: 'feedback', key: 'here' } as const, '')
// Same rule as read_feedback: logged in this folder or one inside it.
const inProject = (cwd: string, dir: string) => cwd === dir || cwd.startsWith(`${dir}/`)
const warmup = atom({ plugin: 'feedback', key: 'warmup' } as const, null as Warmup | null)
// A warm-up the prefetch stopped writing (killed, crashed) is not shown forever.
const WARMUP_STALE_MS = 2 * 60 * 1000
const warmupPath = ($: EngineInterface) => `${$.plugin.root}/data/warmup.json`

const megabytes = (bytes: number) => Math.round(bytes / 1e6)
function warmupText(w: Warmup) {
  if (w.state === 'installing') return 'nudge model: installing…'
  if (w.state !== 'downloading' || !w.total) return 'nudge model: warming up…'
  const share = Math.min(1, w.loaded / w.total)
  const filled = Math.round(share * 12)
  return `nudge model ${'█'.repeat(filled)}${'░'.repeat(12 - filled)} ${Math.round(share * 100)}% · ${megabytes(w.loaded)}/${megabytes(w.total)} MB`
}

// The MCP server owns the store; the mod only reads it, so there is one writer. The store is
// entry lines plus `{ op: 'update' }` lines merged into them, the same fold the server does.
const POLL_MS = 3000
const CARD_SECONDS = 8
const storePath = ($: EngineInterface) => `${$.plugin.root}/data/feedback.jsonl`

async function reload($: EngineInterface) {
  const path = storePath($)
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  const byId = new Map<string, Entry>()
  for (const line of text.split('\n').filter(Boolean)) {
    const { op, ...record } = JSON.parse(line)
    const prior = byId.get(record.id)
    if (op !== 'update') byId.set(record.id, { status: 'open', ...record })
    else if (prior) byId.set(record.id, { ...prior, ...record })
  }
  const list = [...byId.values()].reverse()
  await update($, entries, () => list)
  const dir = await $.session.cwd()
  await update($, here, () => dir)
  await showStatus($)

  return list
}

async function showStatus($: EngineInterface) {
  const w = await read($, warmup)
  if (w && w.state !== 'ready' && w.state !== 'failed') return $.ui.status(warmupText(w))
  const dir = await read($, here)
  const open = (await read($, entries)).filter(one => one.status === 'open' && inProject(one.cwd, dir))
  const count = (severity: Entry['severity']) => open.filter(one => one.severity === severity).length
  // The engine prefixes the plugin name, so this reads "feedback: 3 open · 1 high ...".
  $.ui.status(
    open.length === 0
      ? undefined
      : `${open.length} open · ${count('high')} high · ${count('medium')} medium · ${count('low')} low · /feedback to view`,
  )
}

async function readWarmup($: EngineInterface) {
  const path = warmupPath($)
  if (!(await $.fs.exists(path))) return null
  const w = JSON.parse(await $.fs.read(path)) as Warmup
  return Date.now() - w.at > WARMUP_STALE_MS ? null : w
}

export const register: Register = on => {
  registerTranscript(on)
  // Deferred behind ToolSearch, the model saw only the name and logged nothing outside ai-setup.
  on('tool.describe', { tool: COLLECT }, ($, e) => ({ description: e.description, isDeferred: false }))

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'feedback', description: 'Show reported feedback in a pane' })
    await $.command.register({ name: 'fb', description: 'Log feedback without a model turn: /fb <what could be better>' })
    await reload($)
    // Other sessions and scripts write the store too, so follow the file, not only this session's calls.
    let seen = (await $.fs.exists(storePath($))) ? (await $.fs.stat(storePath($))).mtimeMs : 0
    $.clock.every(POLL_MS, () => {
      void (async () => {
        const now = (await $.fs.exists(storePath($))) ? (await $.fs.stat(storePath($))).mtimeMs : 0
        if (now === seen) return
        seen = now
        await reload($)
      })()
    })
    // The background prefetch writes its progress here; follow it until the model is ready.
    const warmupTick = $.clock.every(1000, () => {
      void (async () => {
        const w = await readWarmup($)
        await update($, warmup, () => w)
        await showStatus($)
        if (w?.state === 'ready' || w?.state === 'failed') warmupTick.cancel()
      })()
    })
    $.clock.after(10 * 60 * 1000, () => warmupTick.cancel())

    return next(e)
  })

  on('command.run', { command: 'feedback' }, async $ => {
    await reload($)
    await $.ui.open({ id: PANE, title: 'Feedback', focus: true, closeOnEscape: true })

    return { text: 'Feedback pane opened.' }
  })

  on('command.run', { command: 'fb' }, async ($, e) => {
    const text = e.args.trim()
    if (!text) return { text: 'Usage: /fb <what went wrong>' }
    const ran = await $.tool.call({ tool: COLLECT, kind: 'pain_point', title: text.slice(0, 80), details: text })

    return { text: ran.deny ?? ran.text ?? 'Feedback logged.' }
  })

  on('tool.call', { tool: COLLECT }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      $.ui.toast(ran.text ?? 'Feedback logged.')
      const list = await reload($)
      const logged = list[0] ?? null
      await update($, justLogged, () => logged)
      await update($, secondsLeft, () => CARD_SECONDS)
      const tick = $.clock.every(1000, () => {
        void (async () => {
          const shown = await read($, justLogged)
          if (shown?.id !== logged?.id) return tick.cancel()
          const left = (await read($, secondsLeft)) - 1
          await update($, secondsLeft, () => left)
          if (left > 0) return
          tick.cancel()
          await update($, justLogged, () => null)
        })()
      })
    }

    return ran
  })

  on('tool.call', { tool: UPDATE }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      $.ui.toast(ran.text ?? 'Feedback updated.')
      await reload($)
    }

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, justLogged, () => null)

    return next(e)
  })

  // A card above the prompt for the entry just logged; whatever other plugins draw there stays below it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const entry = await read($, justLogged)
    if (entry === null || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const left = await read($, secondsLeft)
    const rest = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
          <Text color="green" bold>
            ✓ Feedback logged · {entry.id}
          </Text>
          <Box gap={1}>
            <Text backgroundColor={SEVERITY_COLOR[entry.severity]} color="black" bold>
              {` ${entry.severity.toUpperCase()} `}
            </Text>
            <Text color={KIND_COLOR[entry.kind]} bold>
              {LABEL[entry.kind]}
            </Text>
            <Text wrap="truncate-end">{entry.title}</Text>
          </Box>
          <Box gap={1}>
            <Text dimColor>/feedback to see all · closes in {left}s ·</Text>
            <Button key="dismiss-logged" plain role="dismiss" label="Dismiss" onPress={() => update($, justLogged, () => null)} />
          </Box>
        </Box>
        {rest}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const active = await read($, filter)
    const shown = await read($, show)
    const scoped = await read($, scope)
    const dir = await read($, here)
    const stored = await read($, entries)
    const everything = scoped === 'all' ? stored : stored.filter(one => inProject(one.cwd, dir))
    const all = everything.filter(one => shown === 'all' || one.status === shown)
    const list = all.filter(one => active === 'all' || one.kind === active)
    const width = Math.max(20, e.props.bodyColumns - 2)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Box gap={2}>
            <Text bold>Feedback</Text>
            <Button
              key="scope-toggle"
              plain
              hotkey="p"
              label={scoped === 'all' ? `All projects ${stored.length}` : `This project ${everything.length} · ${stored.length - everything.length} elsewhere`}
              onPress={() => update($, scope, now => (now === 'all' ? 'here' : 'all'))}
            />
            <Button key="close-pane" plain hotkey="q" label="✕ Close" onPress={() => $.ui.close({ id: PANE })} />
          </Box>
          <Text dimColor>
            {everything.filter(one => one.status === 'open').length} open ·{' '}
            {everything.filter(one => one.status === 'open' && one.severity === 'high').length} high
          </Text>
        </Box>
        <Box gap={2} marginTop={1} flexWrap="wrap">
          {SHOWS.map(one => (
            <Button
              key={`show-${one.show}`}
              plain
              hotkey={one.hotkey}
              dimColor={one.show !== shown}
              label={`${one.label} ${one.show === 'all' ? everything.length : everything.filter(entry => entry.status === one.show).length}`}
              onPress={() => update($, show, () => one.show)}
            />
          ))}
        </Box>
        <Box gap={2} marginTop={1} flexWrap="wrap">
          {FILTERS.map((kind, i) => (
            <Button
              key={`filter-${kind}`}
              plain
              hotkey={String(i + 1)}
              dimColor={kind !== active}
              label={`${LABEL[kind]} ${kind === 'all' ? all.length : all.filter(one => one.kind === kind).length}`}
              onPress={() => update($, filter, () => kind)}
            />
          ))}
        </Box>
        <Text dimColor>{'─'.repeat(width)}</Text>
        {list.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor italic>
              {everything.length === 0 ? 'Nothing reported yet. Log one with /fb <what went wrong>.' : 'Nothing under this filter.'}
            </Text>
          </Box>
        )}
        {list.map(one => (
          <Box
            key={one.id}
            flexDirection="column"
            marginTop={1}
            paddingX={1}
            borderStyle="round"
            borderColor={one.status === 'open' ? SEVERITY_COLOR[one.severity] : 'gray'}
          >
            <Box gap={1}>
              <Text backgroundColor={SEVERITY_COLOR[one.severity]} color="black" bold>
                {` ${one.severity.toUpperCase()} `}
              </Text>
              <Text color={KIND_COLOR[one.kind]} bold>
                {LABEL[one.kind]}
              </Text>
              {one.area && <Text dimColor>· {one.area}</Text>}
              {one.status !== 'open' && <Text color={one.status === 'resolved' ? 'green' : 'gray'}>· {one.status === 'resolved' ? '✓ resolved' : "won't fix"}</Text>}
            </Box>
            <Text bold wrap="wrap" strikethrough={one.status !== 'open'}>
              {one.title}
            </Text>
            {one.details !== one.title && (
              <Text dimColor wrap="wrap">
                {one.details.length > 280 ? `${one.details.slice(0, 279)}…` : one.details}
              </Text>
            )}
            {one.resolution && (
              <Text color="green" wrap="wrap">
                → {one.resolution}
              </Text>
            )}
            <Text dimColor>
              {one.createdAt.slice(0, 16).replace('T', ' ')} · {one.cwd.split('/').pop()} · {one.id}
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
