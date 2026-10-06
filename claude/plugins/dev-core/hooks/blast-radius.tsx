import type { On } from 'claude-code'

import { segments } from './mv-guard'

// Blast radius: a Bash command that throws work away (rm -r, git reset --hard, git clean -f, a
// force push, a migration) is held until the person allows it in a question that lists what it
// would remove where a dry run can tell. Auto mode runs these unasked.

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

const LIMIT = 8
const ALLOW = 'Allow'
const BLOCK = 'Block'

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

    // The wait has to be a $ call: the hook's 10 s budget pauses only while one is in flight, and
    // a hook past its budget is skipped, which ran the command unasked.
    const listed = preview.length === 0 ? ['No dry run for this one; nothing listed.'] : preview.slice(0, LIMIT)
    if (preview.length > LIMIT) listed.push(`...and ${preview.length - LIMIT} more`)
    const question = [`Run this ${risky.kind}?`, `$ ${e.command.split('\n')[0]}`, ...listed.map(line => `  ${line}`)].join('\n')
    const answer = await $.ui.ask(question, { header: 'Blast radius', options: [ALLOW, BLOCK] }).catch(() => BLOCK)
    if (answer !== ALLOW) return { deny: `The user blocked this ${risky.kind} after seeing what it would remove. Ask before trying it another way.` }

    return next(e)
  })
}
