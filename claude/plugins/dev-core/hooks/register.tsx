import type { Register } from 'claude-code'

import { registerBlastRadius } from './blast-radius'
import { registerMvGuard } from './mv-guard'
import { registerPinnedTools } from './pin-tools'
import { registerRuleCards } from './rule-cards'
import { registerScreenshots } from './screenshots'

export const register: Register = on => {
  registerMvGuard(on)
  registerBlastRadius(on)
  registerRuleCards(on)
  registerScreenshots(on)
  registerPinnedTools(on)
}
