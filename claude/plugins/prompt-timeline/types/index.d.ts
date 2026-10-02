export type ReplyTag = { model: string; effort: string }
export type Prompt = { id: string; text: string; isDrawn?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'prompt-timeline': { prompts: Prompt[]; replyTags: Record<string, ReplyTag> }
  }
}
