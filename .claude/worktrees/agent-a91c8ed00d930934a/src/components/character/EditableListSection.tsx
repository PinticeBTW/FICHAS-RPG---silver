import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState } from '../common/EmptyState'
import { Panel } from '../common/Panel'

type FieldType = 'text' | 'textarea' | 'number' | 'checkbox' | 'select'

interface FieldOption {
  label: string
  value: string
}

export interface EditableField<T> {
  key: keyof T & string
  label: string
  type: FieldType
  placeholder?: string
  min?: number
  max?: number
  step?: number
  options?: FieldOption[]
}

interface EditableListSectionProps<T extends { id: string }> {
  title: string
  eyebrow: string
  description: string
  items: T[]
  fields: EditableField<T>[]
  emptyTitle: string
  emptyDetail: string
  canEdit: boolean
  onSave: (item: T) => Promise<void>
  onDelete: (id: string) => Promise<void>
  createItem: () => T
}

export function EditableListSection<T extends { id: string }>({
  title,
  eyebrow,
  description,
  items,
  fields,
  emptyTitle,
  emptyDetail,
  canEdit,
  onSave,
  onDelete,
  createItem,
}: EditableListSectionProps<T>) {
  const [drafts, setDrafts] = useState(items)

  useEffect(() => {
    setDrafts(items)
  }, [items])

  const updateDraft = <K extends keyof T & string>(
    id: string,
    key: K,
    value: T[K],
  ) => {
    setDrafts((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, [key]: value } : entry)),
    )
  }

  return (
    <Panel title={title} eyebrow={eyebrow} description={description} className="rounded-[30px]">
      <div className="mb-4 flex justify-end">
        {canEdit ? (
          <button
            type="button"
            className="signal-button px-4 py-2 text-sm"
            onClick={() => setDrafts((current) => [...current, createItem()])}
          >
            Adicionar
          </button>
        ) : null}
      </div>

      {!drafts.length ? (
        <EmptyState title={emptyTitle} detail={emptyDetail} />
      ) : (
        <div className="space-y-4">
          {drafts.map((item) => (
            <article
              key={item.id}
              className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="grid gap-4 lg:grid-cols-2">
                {fields.map((field) => (
                  <label
                    key={`${item.id}-${field.key}`}
                    className={field.type === 'textarea' ? 'lg:col-span-2' : undefined}
                  >
                    <span className="panel-title">{field.label}</span>

                    {field.type === 'textarea' ? (
                      <textarea
                        className="input-shell mt-2 min-h-28 rounded-2xl px-4 py-3"
                        value={String(item[field.key] ?? '')}
                        onChange={(event) =>
                          updateDraft(item.id, field.key, event.target.value as T[typeof field.key])
                        }
                        placeholder={field.placeholder}
                        disabled={!canEdit}
                      />
                    ) : field.type === 'select' ? (
                      <select
                        className="input-shell mt-2 rounded-2xl px-4 py-3"
                        value={String(item[field.key] ?? '')}
                        onChange={(event) =>
                          updateDraft(item.id, field.key, event.target.value as T[typeof field.key])
                        }
                        disabled={!canEdit}
                      >
                        {field.options?.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'checkbox' ? (
                      <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                        <input
                          checked={item[field.key] as boolean}
                          onChange={(event) =>
                            updateDraft(
                              item.id,
                              field.key,
                              event.target.checked as T[typeof field.key],
                            )
                          }
                          type="checkbox"
                          disabled={!canEdit}
                        />
                        <span className="text-sm text-slate-300">
                          {item[field.key] ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                    ) : (
                      <input
                        className="input-shell mt-2 rounded-2xl px-4 py-3"
                        type={field.type}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        value={String(item[field.key] ?? '')}
                        onChange={(event) =>
                          updateDraft(
                            item.id,
                            field.key,
                            (field.type === 'number'
                              ? Number(event.target.value)
                              : event.target.value) as T[typeof field.key],
                          )
                        }
                        placeholder={field.placeholder}
                        disabled={!canEdit}
                      />
                    )}
                  </label>
                ))}
              </div>

              {canEdit ? (
                <div className="mt-4 flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    className="signal-button inline-flex items-center gap-2 px-4 py-2 text-sm"
                    data-tone="danger"
                    onClick={() => void onDelete(item.id)}
                  >
                    <Trash2 size={14} />
                    Apagar
                  </button>
                  <button
                    type="button"
                    className="signal-button px-4 py-2 text-sm"
                    onClick={() => void onSave(item)}
                  >
                    Guardar
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </Panel>
  )
}
