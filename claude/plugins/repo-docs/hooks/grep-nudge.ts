import type { On } from 'claude-code'

// Since find_docs was pinned (2026-10-02), real sessions still ran 113 docs greps to 18
// find_docs calls, mostly on task prompts mid-session. This reminds the model at the grep.
const FIND_DOCS = 'mcp__plugin_repo-docs_repo-docs__find_docs'
const MAX_NUDGES = 2

const SEARCHER = /(^|[\s|;&(])(rg|grep|ag)\s/
const DOCS_TARGET = /(^|[\s'"=/])docs(\/|[\s'"]|$)|\.mdx?\b|--type[= ]md\b|\s-t\s?md\b|README/i
// find_docs does not index these, so grepping them is the right call.
const UNINDEXED = /\.orchestration|\.claude\/|node_modules/

export const NUDGE =
  'repo-docs: that searched the docs with a text pattern. find_docs searches every doc by meaning, so it also finds docs that describe the topic in other words. Run find_docs with a plain description of the task before more doc greps.'

// Only a topic search gets the reminder: plain words like "shopify cli" or "digest|drift". An
// exact string (`MODEL_ID =`, `offsets.json`, a hex colour, a URL) is a lookup grep does well:
// on 30 real docs greps followed by opening a doc, find_docs ranked that doc top 3 only 4 times.
export const isTopicPattern = (pattern: string) => {
  const words = pattern.split(/\\?\||\s+/).filter(Boolean)
  return words.length > 0 && words.every(w => /^[A-Za-z][a-z]+(-[a-z]+)*$/.test(w)) && (words.length > 1 || words[0].length >= 4)
}

// The first argument after the search command that is not a flag, unquoted.
const patternOf = (segment: string) => {
  const args = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  const at = args.findIndex(a => /^(rg|grep|ag)$/.test(a))
  for (let i = at + 1; i > 0 && i < args.length; i++) {
    if (args[i] === '-e') return args[i + 1]?.replace(/^(["'])(.*)\1$/, '$2') ?? ''
    if (!args[i].startsWith('-')) return args[i].replace(/^(["'])(.*)\1$/, '$2')
  }
  return ''
}

// The docs path has to follow the search command within one pipeline segment, so prose that
// mentions "rg" and "docs" (a heredoc, a prompt string) does not count. A `|` inside quotes is
// a pattern alternation, not a pipe.
export const isBashDocsGrep = (command: string) =>
  (command.match(/(?:"[^"]*"|'[^']*'|[^|;&\n"'])+/g) ?? []).some(part => {
    const at = part.search(SEARCHER)
    return at >= 0 && DOCS_TARGET.test(part.slice(at)) && isTopicPattern(patternOf(part.slice(at)))
  }) && !UNINDEXED.test(command)

export const isGrepToolDocsSearch = (input: { pattern?: string; path?: string; glob?: string; type?: string }) => {
  const scopes = [input.path ?? '', input.glob ?? '']
  const isDocs = scopes.some(s => /(^|\/)docs(\/|$)|\.mdx?\b|README/i.test(s)) || input.type === 'md' || input.type === 'markdown'
  return isDocs && isTopicPattern(input.pattern ?? '') && !scopes.some(s => UNINDEXED.test(s))
}

export function registerGrepNudge(on: On) {
  let hasCalledFindDocs = false
  let nudges = 0

  const nudge = <R extends { deny?: string; context?: readonly string[] }>(ran: R): R => {
    if (hasCalledFindDocs || nudges >= MAX_NUDGES || ran.deny !== undefined) return ran
    nudges++
    return { ...ran, context: [...(ran.context ?? []), NUDGE] }
  }

  on('tool.call', { tool: FIND_DOCS }, ($, e, next) => {
    hasCalledFindDocs = true
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    return isBashDocsGrep(e.command) ? nudge(ran) : ran
  })

  on('tool.call', { tool: 'Grep' }, async ($, e, next) => {
    const ran = await next(e)
    return isGrepToolDocsSearch(e) ? nudge(ran) : ran
  })
}
