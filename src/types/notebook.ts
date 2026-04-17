export type NoteChecklistFilter = 'all' | 'open' | 'completed'

export type NoteChecklistItem = {
  id: string
  text: string
  completed: boolean
  order: number
  createdAt?: string
}

export type NotebookPageCore = {
  id: string
  title: string
  content: string
  pinned: boolean
  checklistItems: NoteChecklistItem[]
}

