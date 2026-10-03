import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { Held } from '../types'
import { segments } from './mv-guard'

// Blast radius: a Bash command that throws work away (rm -r, git reset --hard, git clean -f, a
// force push, a migration) is held until the person allows it from a card above the prompt,
// which lists what it would remove where a dry run can tell. Auto mode runs these unasked.

const held = atom({ plugin: 'dev-core', key: 'blastRadius' } as const, null as Held | null)

const RISKY: { kind: string; re: RegExp }[] = [
  { kind: 'rm -r', re: /^rm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*\s+|--recursive\s+)/ },
  { kind: 'git reset --hard', re: /^git\s+(?:-C\s+\S+\s+)?reset\s+.*--hard\b/ },
  { kind: 'git clean', re: /^git\s+(?:-C\s+\S+\s+)?clean\s+(?:.*\s)?-[a-zA-Z]*f/ },
  { kind: 'force push', re: /^git\s+(?:-C\s+\S+\s+)?push\s+(?:.*\s)?(?:--force(?:-with-lease)?\b|-[a-zA-Z]*f\b)/ },
  { kind: 'migration', re: /\b(?:prisma\s+migrate|migrate\s+(?:reset|deploy|up|down)|db:(?:migrate|drop|reset|rollback))\b/ },
]

export function riskyPart(command: string) {
  for (const segment of segments(command)) {
    const hit = RISKY.find(one => one.re.test(segment))
    if (hit) return { kind: hit.kind, segment }
  }

  return null
}

let isInteractive = false
export const setInteractive = (value: boolean) => (isInteractive = value)

// Answers for held calls, by id, filled by the card's buttons.
const waiting = new Map<string, (allow: boolean) => void>()
const LIMIT = 8

export function registerBlastRadius(on: On) {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const risky = riskyPart(e.command)
    // A -p run has nobody to ask.
    if (!risky || !isInteractive) return next(e)
    const lines = async (argv: string[]) => {
      const ran = await $.process.run(argv)
      return ran.exitCode === 0 ? ran.stdout.split('\n').filter(Boolean) : []
    }
    const args = risky.segment.split(/\s+/).slice(1)
    let preview: string[] = []
    if (risky.kind === 'git reset --hard') preview = (await lines(['git', 'status', '--porcelain'])).map(line => `lose changes: ${line.slice(3)}`)
    if (risky.kind === 'git clean') preview = await lines(['git', ...args.map(arg => (/^-[a-zA-Z]*f/.test(arg) ? arg.replace('f', 'n') : arg))])
    if (risky.kind === 'rm -r') {
      const paths = args.filter(arg => !arg.startsWith('-'))
      const files = await lines(['find', ...paths, '-type', 'f'])
      preview = files.length ? [`${files.length} file${files.length === 1 ? '' : 's'}:`, ...files] : []
    }
    if (risky.kind === 'force push') preview = (await lines(['git', 'log', '--oneline', 'HEAD..@{upstream}'])).map(line => `drop remote commit: ${line}`)

    const id = e.tool_use_id
    const answer = new Promise<boolean>(resolve => waiting.set(id, resolve))
    await update($, held, () => ({ id, command: e.command, kind: risky.kind, preview }))
    const allow = await answer
    waiting.delete(id)
    await update($, held, shown => (shown?.id === id ? null : shown))
    if (!allow) return { deny: `The user blocked this ${risky.kind} after seeing what it would remove. Ask before trying it another way.` }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const card = await read($, held)
    const rest = await next(e)
    if (!card) return rest
    const { Box, Button, Text } = $.ui.resolve(e)
    const answer = (allow: boolean) => waiting.get(card.id)?.(allow)

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1} marginRight={1}>
          <Text color="red" bold>
            ⚠ Blast radius · {card.kind}
          </Text>
          <Text wrap="truncate-end">$ {card.command.split('\n')[0]}</Text>
          {card.preview.length === 0 && <Text dimColor>No dry run for this one; nothing listed.</Text>}
          {card.preview.slice(0, LIMIT).map((line, i) => (
            <Text key={`p${i}`} dimColor wrap="truncate-end">
              {`  ${line}`}
            </Text>
          ))}
          {card.preview.length > LIMIT && <Text dimColor>{`  …and ${card.preview.length - LIMIT} more`}</Text>}
          <Box gap={3} marginTop={1}>
            <Button key="blast-allow" hotkey="y" label="Allow" onPress={() => answer(true)} />
            <Button key="blast-block" hotkey="n" label="Block" onPress={() => answer(false)} />
          </Box>
        </Box>
        {rest}
      </Box>
    )
  })
}
