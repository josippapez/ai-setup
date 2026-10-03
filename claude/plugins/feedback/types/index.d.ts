export type Status = 'open' | 'resolved' | 'wontfix'
export type Kind = 'bug' | 'pain_point' | 'ambiguity' | 'idea'
export type Entry = {
  id: string
  createdAt: string
  kind: Kind
  severity: 'low' | 'medium' | 'high'
  title: string
  details: string
  area?: string
  cwd: string
  status: Status
  resolution?: string
  updatedAt?: string
}

declare module 'claude-code' {
  interface PluginState {
    feedback: { entries: Entry[]; filter: Kind | 'all'; justLogged: Entry | null; show: Status | 'all'; secondsLeft: number }
  }
}
