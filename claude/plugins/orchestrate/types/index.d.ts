export type Issue = { id: string; title: string; status: string; wave: string }
export type Epic = { slug: string; title: string; issues: Issue[] }

declare module 'claude-code' {
  interface PluginState {
    orchestrate: { epics: Epic[]; showDone: boolean }
  }
}
