import { useMemo, useState } from 'react'
import {
  createNoteChecklistItem,
  getChecklistProgress,
  getNextChecklistItemOrder,
  sortNoteChecklistItems,
} from '../../lib/noteChecklist'
import type { NoteChecklistItem } from '../../types/notebook'
import { AddChecklistItemInput } from './AddChecklistItemInput'
import { ChecklistItemRow } from './ChecklistItemRow'

type NoteChecklistProps = {
  items: NoteChecklistItem[]
  canEdit: boolean
  onChange: (items: NoteChecklistItem[]) => void
  className?: string
}

export function NoteChecklist({
  items,
  canEdit,
  onChange,
  className,
}: NoteChecklistProps) {
  const [newItemText, setNewItemText] = useState('')
  const [pendingFocusItemId, setPendingFocusItemId] = useState<string | null>(null)
  const sortedItems = useMemo(() => sortNoteChecklistItems(items), [items])
  const progress = useMemo(() => getChecklistProgress(sortedItems), [sortedItems])

  const handleAddItem = () => {
    if (!canEdit) {
      return
    }

    const trimmedText = newItemText.trim()
    const nextItem = createNoteChecklistItem(
      trimmedText,
      getNextChecklistItemOrder(sortedItems),
    )

    onChange([...sortedItems, nextItem])
    setPendingFocusItemId(trimmedText ? null : nextItem.id)
    setNewItemText('')
  }

  const updateItem = (itemId: string, updater: (item: NoteChecklistItem) => NoteChecklistItem) => {
    onChange(
      sortedItems.map((item) => (item.id === itemId ? updater(item) : item)),
    )
  }

  const deleteItem = (itemId: string) => {
    onChange(sortedItems.filter((item) => item.id !== itemId))
    setPendingFocusItemId((current) => (current === itemId ? null : current))
  }

  return (
    <section className={`note-checklist-panel ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="panel-title">Checklist</p>
          <p className="mt-1 text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
            {progress.completed}/{progress.total} concluida{progress.completed === 1 ? '' : 's'}
          </p>
        </div>

        {progress.total ? (
          <div className="rounded-full border border-[#53b5ff]/25 bg-[#53b5ff]/10 px-2.5 py-1 text-[0.62rem] uppercase tracking-[0.18em] text-[#8bd2ff]">
            {progress.remaining} por fazer
          </div>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        {sortedItems.length ? (
          sortedItems.map((item) => (
            <ChecklistItemRow
              key={item.id}
              item={item}
              canEdit={canEdit}
              autoFocus={pendingFocusItemId === item.id}
              onAutoFocusComplete={() => setPendingFocusItemId((current) => (current === item.id ? null : current))}
              onToggle={() =>
                updateItem(item.id, (current) => ({
                  ...current,
                  completed: !current.completed,
                }))
              }
              onTextChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  text: value,
                }))
              }
              onDelete={() => deleteItem(item.id)}
            />
          ))
        ) : (
          <div className="border border-dashed border-white/10 bg-black/20 px-4 py-4 text-xs leading-6 text-stone-500">
            Ainda nao tens tarefas nesta pagina. Usa a checklist para acompanhar pistas,
            objetivos ou coisas por investigar.
          </div>
        )}
      </div>

      <AddChecklistItemInput
        value={newItemText}
        canEdit={canEdit}
        onChange={setNewItemText}
        onAdd={handleAddItem}
      />
    </section>
  )
}
