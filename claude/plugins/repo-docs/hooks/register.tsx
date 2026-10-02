import type { Register } from 'claude-code'

import { registerReindex } from './reindex'
import { registerStatus } from './status'
import { registerTranscript } from './transcript'

export const register: Register = on => {
  registerReindex(on)
  registerStatus(on)
  registerTranscript(on)
}
