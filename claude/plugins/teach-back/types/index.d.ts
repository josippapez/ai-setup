export type Section = {
  heading: string
  /** Markdown. */
  body: string
  /** Why it was done this way, and the alternative that lost. */
  why?: string
  files?: string[]
  code?: { path?: string; language?: string; source: string; isDiff?: boolean }
}

export type Question =
  | { kind: 'choice'; prompt: string; options: string[]; answer: number; explain: string; section?: number }
  | { kind: 'explain'; prompt: string; modelAnswer: string; rubric: string; section?: number }

export type Verdict = 'right' | 'partly' | 'wrong'

export type Answer = {
  picked?: number
  text?: string
  verdict?: Verdict
  feedback?: string
  isGrading?: boolean
}

export type Lesson = {
  id: string
  createdAt: string
  /** The session root the lesson was made in. */
  project: string
  title: string
  ask?: string
  summary: string
  sections: Section[]
  questions: Question[]
  /** One per question, null until answered. */
  answers: (Answer | null)[]
}

/** The files changed since the last lesson, for the Teach me button. */
export type Offer = { files: string[] }

declare module 'claude-code' {
  interface PluginState {
    'teach-back': {
      lessons: Shaped<Lesson[]>
      current: string | null
      step: number
      preparing: boolean
      offer: Offer | null
      project: string
    }
  }
}
