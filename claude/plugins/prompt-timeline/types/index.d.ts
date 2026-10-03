export type ReplyTag = { model: string; effort: string }
export type Prompt = { id: string; text: string; isDrawn?: boolean }
export type FileEdit = { tool: 'Edit' | 'Write'; file: string; before: string; after: string }

declare module 'claude-code' {
  interface PluginState {
    'prompt-timeline': { prompts: Prompt[]; replyTags: Record<string, ReplyTag>; enlarged: { png: string; width: number; height: number } | null; replay: { edits: FileEdit[]; at: number; isNew: boolean } }
  }
}
