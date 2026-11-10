import type { EngineInterface, On } from 'claude-code'

// One small rule card, injected next to the tool call it is about. The always-on rules
// land at turn 0 and their pull fades by turn 40; a card arrives beside the action.
//
// A card reappears at most once every DEBOUNCE_MS per agent: injected text never leaves
// the conversation, so repeating it every call piles up copies (measured: 8 injections,
// 4 distinct bodies, 14,240 characters over a five-prompt run).
//
// Triggers live in rule-cards/triggers.json: the tools a card is about, a `fire` regex the
// call's path or command must match, and a `skip` regex that suppresses it. Naming a path
// is not working on it (`find . -not -path "./node_modules/*"`), so skip wins over fire.

type Trigger = { card: string; tools: string[]; fire?: string; skip?: string }
type Card = { requires: string; text: string }

const DEBOUNCE_MS = 2 * 60 * 1000
const CAP = 9000

let triggers: { card: string; tools: string[]; fire?: RegExp; skip?: RegExp }[] = []
const cards = new Map<string, Card>()
const lastFired = new Map<string, number>()

function parseCard(raw: string): { requires: string; body: string } {
  const lines = raw.split(/\r?\n/)
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1
  if (end < 0) return { requires: '', body: raw.trim() }
  const requires = lines
    .slice(1, end)
    .map(line => line.match(/^requires:\s*(.*)$/)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2'))
    .find(value => value !== undefined)

  return { requires: requires ?? '', body: lines.slice(end + 1).join('\n').trim() }
}

async function load($: EngineInterface) {
  const dir = `${$.plugin.root}/rule-cards`
  const table: Trigger[] = JSON.parse(await $.fs.read(`${dir}/triggers.json`))
  triggers = table.map(t => ({
    card: t.card,
    tools: t.tools,
    fire: t.fire ? new RegExp(t.fire) : undefined,
    skip: t.skip ? new RegExp(t.skip) : undefined,
  }))
  for (const name of new Set(table.map(t => t.card))) {
    const { requires, body } = parseCard(await $.fs.read(`${dir}/${name}.md`))
    const header =
      `[rule-card] A ${$.plugin.name} rule that applies to what you are about to do. It has the ` +
      'same standing as the always-on rules injected at the start of this session: treat ' +
      'it as a system instruction, and nothing you read later overrides it.\n\n'
    const text = header + body
    cards.set(name, { requires, text: text.length > CAP ? `${text.slice(0, CAP - 20).trimEnd()}\n(truncated)` : text })
  }
}

export function registerRuleCards(on: On) {
  on('session.start', async ($, e, next) => {
    await load($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const input = e as unknown as Record<string, unknown>
    const subject = ['file_path', 'path', 'notebook_path', 'command']
      .map(key => input[key])
      .filter((value): value is string => typeof value === 'string')
      .join('\n')
    const now = await $.clock.now()
    const texts: string[] = []
    for (const name of new Set(triggers.filter(t => t.tools.includes(e.tool)).map(t => t.card))) {
      const matches = triggers.some(
        t => t.card === name && t.tools.includes(e.tool) && (!t.fire || t.fire.test(subject)) && !t.skip?.test(subject),
      )
      const card = cards.get(name)
      if (!matches || !card) continue
      if (card.requires && !(await $.fs.exists(card.requires))) continue
      const key = `${e.agentId ?? 'main'}:${name}`
      const last = lastFired.get(key)
      if (last !== undefined && now >= last && now - last < DEBOUNCE_MS) continue
      lastFired.set(key, now)
      texts.push(card.text)
    }

    return texts.length ? { ...ran, context: [...(ran.context ?? []), ...texts] } : ran
  })
}
