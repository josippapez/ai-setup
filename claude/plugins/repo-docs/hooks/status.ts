import type { EngineInterface, On } from 'claude-code'

// The MCP server holds this lock for the whole index build and removes it when done,
// and keeps "<done> <total>" in the progress file while it runs.
const LOCK = '.claude/repo-docs/index-build.lock'
const PROGRESS = '.claude/repo-docs/index-build.progress'
const POLL_MS = 3000

async function poll($: EngineInterface, wasIndexing: boolean) {
  const isIndexing = await $.fs.exists(LOCK)
  if (isIndexing) {
    const [done, total] = ((await $.fs.exists(PROGRESS)) ? await $.fs.read(PROGRESS) : '').split(' ').map(Number)
    // The engine prefixes the plugin name, so the text starts at the verb.
    $.ui.status(total ? `indexing docs ${Math.floor(((done ?? 0) * 100) / total)}% (${done}/${total})` : 'indexing docs…')
  }
  if (!isIndexing && wasIndexing) {
    $.ui.status(undefined)
    $.ui.toast('repo-docs: doc index updated')
  }

  return isIndexing
}

export function registerStatus(on: On) {
  on('session.start', async ($, e, next) => {
    let isIndexing = await poll($, false)
    $.clock.every(POLL_MS, () => {
      void poll($, isIndexing).then(now => {
        isIndexing = now
      })
    })

    return next(e)
  })
}
