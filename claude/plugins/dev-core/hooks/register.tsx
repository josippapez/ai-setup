import type { Register } from 'claude-code'

import { registerMvGuard } from './mv-guard'
import { registerRuleCards } from './rule-cards'
import { registerScreenshots } from './screenshots'

export const register: Register = on => {
  registerMvGuard(on)
  registerRuleCards(on)
  registerScreenshots(on)
}
