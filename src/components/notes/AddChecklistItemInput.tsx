import { Plus } from 'lucide-react'
import type { KeyboardEventHandler } from 'react'

type AddChecklistItemInputProps = {
  value: string
  canEdit: boolean
  onChange: (value: string) => void
  onAdd: () => void
}

export function AddChecklistItemInput({
  value,
  canEdit,
  onChange,
  onAdd,
}: AddChecklistItemInputProps) {
  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onAdd()
    }
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      <input
        type="text"
        value={value}
        readOnly={!canEdit}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Adicionar tarefa, objetivo ou pista..."
        className="note-checklist-input-shell min-w-0 flex-1"
      />

      <button
        type="button"
        onClick={onAdd}
        disabled={!canEdit}
        className="signal-button inline-flex items-center gap-2 px-3 py-2 text-xs"
      >
        <Plus size={12} />
        Adicionar tarefa
      </button>
    </div>
  )
}

