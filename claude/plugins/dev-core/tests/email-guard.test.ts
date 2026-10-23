import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const OK = { result: { stdout: '', stderr: '', interrupted: false }, text: '' }

function stub(on: On) {
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'me@git.dev\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('fs.read', () => ({ value: JSON.stringify({ oauthAccount: { emailAddress: 'Me@Work.io' } }) }))
  on('tool.call', () => OK)
}

test('the crates.io User-Agent call from 2026-10-08 is denied', async ($, on) => {
  stub(on)
  const ran = await $.tool.call({
    tool: 'Bash',
    command: 'curl -s -A "wings-research (me@work.io)" "https://crates.io/api/v1/crates/tauri"',
  })
  expect(ran.deny).toContain('me@work.io')
})

test('header flags and script user agents are denied for both addresses', async ($, on) => {
  stub(on)
  const denied = [
    { tool: 'Bash', command: `curl -H 'From: me@git.dev' https://en.wikipedia.org/w/api.php` },
    { tool: 'Bash', command: `python3 -c "requests.get(u, headers={'User-Agent': 'bot (me@git.dev)'})"` },
    { tool: 'Bash', command: `agent-browser --user-agent "bot (me@work.io)" open https://example.com` },
  ]
  for (const call of denied) expect((await $.tool.call(call)).deny).toBeDefined()
})

test('bodies, commits and other addresses run', async ($, on) => {
  stub(on)
  const allowed = [
    { tool: 'Bash', command: `git -c user.email="me@work.io" commit -qm "fix"` },
    { tool: 'Bash', command: `curl -H 'Content-Type: application/json' -d '{"assignee":"me@work.io"}' https://dev.azure.com/x` },
    { tool: 'Bash', command: 'curl -A "ai-setup-agent (noreply@example.com)" https://crates.io/api/v1/crates/tauri' },
  ]
  for (const call of allowed) expect((await $.tool.call(call)).deny).toBeUndefined()
})

test('an address the user typed this session is allowed', async ($, on) => {
  stub(on)
  on('prompt.submit', () => ({ text: '' }))
  const call = { tool: 'Bash', command: 'curl -A "bot (me@work.io)" https://crates.io' }
  expect((await $.tool.call(call)).deny).toBeDefined()
  await $.prompt.submit({ text: 'yes, use me@work.io as the contact' })
  expect((await $.tool.call(call)).deny).toBeUndefined()
})
