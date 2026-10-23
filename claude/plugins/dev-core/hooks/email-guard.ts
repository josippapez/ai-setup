import type { EngineInterface, On } from 'claude-code'

// Refuse a Bash command that puts the user's email in a request header. Sites that
// ask for contact info (crates.io and Wikipedia API policies want it in the User-Agent)
// get the address the model knows: the Claude account's or git's. Measured 2026-10-08: a
// research subagent sent `curl -A "wings-research (<work email>)"` to crates.io 24 times.
// Request bodies are left alone: assigning a work item or committing names the user on
// purpose. An address the user typed this session is allowed, so "ask first" can end in yes.

let known: Promise<string[]> | undefined
const allowed = new Set<string>()

async function emails($: EngineInterface) {
  const found: string[] = []
  const git = await $.process.run(['git', 'config', '--get-all', 'user.email'])
  if (git.exitCode === 0) found.push(...git.stdout.split('\n'))
  const home = await $.env.get('HOME')
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? home
  try {
    const config = JSON.parse(await $.fs.read(`${dir}/.claude.json`))
    found.push(config?.oauthAccount?.emailAddress ?? '')
  } catch {
    // No login record: git's address is all there is to guard.
  }

  return [...new Set(found.map(s => s.trim().toLowerCase()).filter(s => s.includes('@')))]
}

const HEADER_FLAG = /(?:^|\s)(?:-A|-H|--user-agent|--header|--headers)(?:\s+|=)("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/g
const USER_AGENT = /user[-_ ]?agent[^\n]{0,80}/gi

function leaked(text: string, addresses: string[]) {
  const spots = [
    ...[...text.matchAll(HEADER_FLAG)].map(m => m[1] ?? ''),
    ...(text.match(USER_AGENT) ?? []),
  ].map(s => s.toLowerCase())

  return addresses.find(a => spots.some(s => s.includes(a)))
}

export function registerEmailGuard(on: On) {
  on('prompt.submit', async ($, e, next) => {
    known ??= emails($)
    for (const a of await known) if (e.text.toLowerCase().includes(a)) allowed.add(a)

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!e.command.includes('@')) return next(e)
    known ??= emails($)
    const hit = leaked(e.command, (await known).filter(a => !allowed.has(a)))
    if (!hit) return next(e)

    return {
      deny:
        `This call sends the user's email (${hit}) in a request header, where the site ` +
        'logs it. A site that asks for contact info does not get the user\'s address: drop the ' +
        'header, or use a placeholder such as `ai-setup-agent (noreply@example.com)`. Send the ' +
        'real address only after the user types it in a message.',
    }
  })
}
