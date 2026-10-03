export type Held = { id: string; command: string; kind: string; preview: string[] }

declare module 'claude-code' {
  interface PluginState {
    'dev-core': { blastRadius: Held | null }
  }
}
