import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Verdict } from '../types'

const last = atom({ plugin: 'verified', key: 'last' } as const, null as Verdict | null)

// The Stop hook's block reason goes only to the model; this shows the person what was flagged.
export const register: Register = on => {
  on('classic.Stop', async ($, e, next) => {
    const ran = await next(e)
    if (ran.block?.startsWith('verified:')) {
      const lines = ran.block.split('\n')
      const claims = lines.filter(line => line.startsWith('  - [')).map(line => line.slice(4))
      await update($, last, () => ({ headline: lines[0] ?? '', claims }))
      $.ui.toast(`verified sent the answer back: ${claims.length} unbacked ${claims.length === 1 ? 'claim' : 'claims'}`)
    }

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, last, () => null)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const verdict = await read($, last)
    if (verdict === null || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const rest = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Box justifyContent="space-between">
            <Text color="yellow" bold>
              verified redid the last answer
            </Text>
            <Button key="dismiss" plain role="dismiss" label="Dismiss" onPress={() => update($, last, () => null)} />
          </Box>
          {verdict.claims.map((claim, i) => (
            <Text key={`claim-${i}`} dimColor wrap="truncate-end">
              {claim}
            </Text>
          ))}
        </Box>
        {rest}
      </Box>
    )
  })
}
