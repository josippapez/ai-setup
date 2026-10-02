import type { On } from 'claude-code'

// Ask the running repo-docs server to re-embed changed docs once a turn ends, if the turn
// touched a markdown file. The old PostToolUse hook only saw Edit and Write, but most doc
// edits go through Bash (sed, heredocs, scripts), so they were never reindexed. A rebuild
// parses the whole index, so it runs once per turn, not once per edit.

const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const DOC = /\.mdx?\b/i

let isDirty = false

export function registerReindex(on: On) {
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const input = e as unknown as Record<string, unknown>
    const subject = String(input.file_path ?? input.notebook_path ?? (e.tool === 'Bash' ? input.command : '') ?? '')
    if ((EDIT_TOOLS.includes(e.tool) || e.tool === 'Bash') && DOC.test(subject)) isDirty = true

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && isDirty) {
      isDirty = false
      const cwd = await $.session.cwd()
      // Started off the turn's own dispatch so the turn does not wait on the rebuild.
      // The script handles the socket, its 2 s debounce lock, and a missing server.
      $.clock.after(0, () => {
        void $.process.run(['node', `${$.plugin.root}/hooks/reindex-on-edit.cjs`, '--now', cwd])
      })
    }

    return next(e)
  })
}
