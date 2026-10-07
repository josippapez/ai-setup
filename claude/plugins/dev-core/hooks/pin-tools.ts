import type { On } from 'claude-code'

// Listed in the prompt instead of behind ToolSearch. In a week of real sessions the model loaded
// WebFetch through ToolSearch 19 times and Monitor 7 times, one extra round trip each, while
// polling with blind `sleep` 64 times. The external-facts rule sends it to the web on most answers.
const PINNED = ['WebFetch', 'Monitor']

export function registerPinnedTools(on: On) {
  for (const tool of PINNED) on('tool.describe', { tool }, ($, e) => ({ description: e.description, isDeferred: false }))
}
