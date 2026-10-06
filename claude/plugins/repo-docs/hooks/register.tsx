import type { Register } from 'claude-code'

import { registerGrepNudge } from './grep-nudge'
import { registerReindex } from './reindex'
import { registerStatus } from './status'
import { registerTranscript } from './transcript'

export const register: Register = on => {
  registerGrepNudge(on)
  registerReindex(on)
  registerStatus(on)
  registerTranscript(on)
  // find_docs was left behind ToolSearch and the model grepped docs instead; listing it up
  // front lets it be called straight away.
  on('tool.describe', { tool: 'mcp__plugin_repo-docs_repo-docs__find_docs' }, ($, e) => ({ description: e.description, isDeferred: false }))
}
