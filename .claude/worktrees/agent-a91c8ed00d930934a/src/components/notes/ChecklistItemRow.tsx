import { Check, Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { NoteChecklistItem } from '../../types/notebook'

type ChecklistItemRowProps = {
  item: NoteChecklistItem
  canEdit: boolean
  autoFocus?: boolean
  onAutoFocusComplete?: () => void
  onToggle: () => void
  onTextChange: (value: string) => void
  onDelete: () => void
}

export function ChecklistItemRow({
  item,
  canEdit,
  autoFocus = false,
  onAutoFocusComplete,
  onToggle,
  onTextChange,
  onDelete,
}: ChecklistItemRowProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!autoFocus || !inputRef.current) {
      return
    }

    inputRef.current.focus()
    inputRef.current.setSelectionRange(item.text.length, item.text.length)
    onAutoFocusComplete?.()
  }, [autoFocus, item.text.length, onAutoFocusComplete])

  return (
    <div className="note-checklist-item group">
      <button
        type="button"
        onClick={onToggle}
        disabled={!canEdit}
        className="note-checklist-checkbox"
        data-completed={item.completed ? 'true' : 'false'}
        title={item.completed ? 'Marcar como por fazer' : 'Marcar como concluida'}
      >
        {item.completed ? <Check size={13} /> : null}
      </button>

      <input
        ref={inputRef}
        type="text"
        value={item.text}
        readOnly={!canEdit}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="Nova tarefa..."
        data-completed={item.completed ? 'true' : 'false'}
        className="note-checklist-text"
      />

      <button
        type="button"
        onClick={onDelete}
        disabled={!canEdit}
        className="note-checklist-delete"
        title="Apagar tarefa"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

