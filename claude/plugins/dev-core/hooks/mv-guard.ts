import type { On } from 'claude-code'

// Refuse a plain `mv` of a git-tracked file: mv plus git add records a delete and an add,
// which loses the history link. The one rule here a hook can enforce rather than remind.
// The command is split on unquoted && || ; | & and newlines, since the model chains the mv
// (`mv a b && sed -i ...`). Only a two-argument mv of a tracked source is denied; anything
// it cannot parse with confidence runs, because a false deny blocks the user.

const unquote = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2')

export function segments(command: string) {
  const out: string[] = []
  let buf = ''
  let quote = ''
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i] ?? ''
    if (quote) {
      buf += c
      if (c === quote && command[i - 1] !== '\\') quote = ''
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      buf += c
      continue
    }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||') {
      out.push(buf)
      buf = ''
      i += 1
      continue
    }
    if (c === ';' || c === '|' || c === '&' || c === '\n') {
      out.push(buf)
      buf = ''
      continue
    }
    buf += c
  }
  out.push(buf)

  return out.map(s => s.trim()).filter(Boolean)
}

export function parsePlainMv(command: string) {
  const m = command
    .trim()
    .match(
      /^mv(?:\s+-[a-zA-Z]+)?\s+("(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)*'|[^\s*?[\]|&;<>$`]+)\s+("(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)*'|[^\s*?[\]|&;<>$`]+)\s*$/,
    )
  if (!m?.[1] || !m[2]) return null
  const src = unquote(m[1])
  // Scratch and temp paths are never the repo's history.
  if (/^(\/tmp\/|\/var\/folders\/|\/private\/tmp\/)/.test(src)) return null

  return { src, dest: unquote(m[2]) }
}

const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

export function registerMvGuard(on: On) {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // A `cd` earlier in the same command moves where the mv runs: `cd repo && mv a b`.
    let dir = ''
    let parsed: { src: string; dest: string } | null = null
    for (const segment of segments(e.command)) {
      const cd = segment.match(/^cd\s+("[^"]+"|'[^']+'|\S+)$/)?.[1]
      if (cd) dir = unquote(cd).startsWith('/') ? unquote(cd) : `${dir || '.'}/${unquote(cd)}`
      parsed = parsePlainMv(segment)
      if (parsed) break
    }
    if (!parsed) return next(e)
    const base = await $.session.cwd()
    const cwd = dir.startsWith('/') ? dir : dir ? `${base}/${dir}` : base
    const inTree = await $.process.run(['git', '-C', cwd, 'rev-parse', '--is-inside-work-tree'])
    if (inTree.exitCode !== 0 || inTree.stdout.trim() !== 'true') return next(e)
    // `ls-files --error-unmatch` fails for untracked and ignored files alike.
    const tracked = await $.process.run(['git', '-C', cwd, 'ls-files', '--error-unmatch', '--', parsed.src])
    if (tracked.exitCode !== 0) return next(e)

    return {
      deny:
        `${parsed.src} is tracked by git. A plain mv records this as a delete plus an ` +
        `add, which loses the file's history and hides the rename in the diff. Run ` +
        `\`git mv ${shellQuote(parsed.src)} ${shellQuote(parsed.dest)}\` instead.`,
    }
  })
}
