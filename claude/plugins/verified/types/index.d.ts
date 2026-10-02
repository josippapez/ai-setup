export type Verdict = { headline: string; claims: string[] }

declare module 'claude-code' {
  interface PluginState {
    verified: { last: Verdict | null }
  }
}
