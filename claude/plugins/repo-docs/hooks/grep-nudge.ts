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

// The docs path has to follow the search command within one pipeline segment, so prose that
// mentions "rg" and "docs" (a heredoc, a prompt string) does not count.
export const isBashDocsGrep = (command: string) =>
  command.split(/[|;&\n]/).some(part => {
    const at = part.search(SEARCHER)
    return at >= 0 && DOCS_TARGET.test(part.slice(at))
  }) && !UNINDEXED.test(command)

export const isGrepToolDocsSearch = (input: { path?: string; glob?: string; type?: string }) => {
  const scopes = [input.path ?? '', input.glob ?? '']
  const isDocs = scopes.some(s => /(^|\/)docs(\/|$)|\.mdx?\b|README/i.test(s)) || input.type === 'md' || input.type === 'markdown'
  return isDocs && !scopes.some(s => UNINDEXED.test(s))
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
