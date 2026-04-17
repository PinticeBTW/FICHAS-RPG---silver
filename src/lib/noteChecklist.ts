import type { NoteChecklistItem } from '../types/notebook'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function createNoteChecklistItem(text = '', order = 0): NoteChecklistItem {
  return {
    id: crypto.randomUUID(),
    text,
    completed: false,
    order,
    createdAt: new Date().toISOString(),
  }
}

export function sortNoteChecklistItems(items: NoteChecklistItem[]) {
  return [...items].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order
    }

    if (left.createdAt && right.createdAt) {
      return left.createdAt.localeCompare(right.createdAt)
    }

    return left.id.localeCompare(right.id)
  })
}

export function parseNoteChecklistItems(value: unknown): NoteChecklistItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return sortNoteChecklistItems(
    value
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry, index) => {
        const item = entry as Record<string, unknown>

        return {
          id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
          text: typeof item.text === 'string' ? item.text : '',
          completed: Boolean(item.completed),
          order: isFiniteNumber(item.order) ? item.order : index,
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
        }
      }),
  )
}

export function getNextChecklistItemOrder(items: NoteChecklistItem[]) {
  return items.reduce((highestOrder, item) => Math.max(highestOrder, item.order), -1) + 1
}

export function getChecklistProgress(items: NoteChecklistItem[]) {
  const total = items.length
  const completed = items.filter((item) => item.completed).length

  return {
    total,
    completed,
    remaining: Math.max(0, total - completed),
  }
}

export function buildChecklistSearchText(items: NoteChecklistItem[]) {
  return sortNoteChecklistItems(items)
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join(' ')
}

