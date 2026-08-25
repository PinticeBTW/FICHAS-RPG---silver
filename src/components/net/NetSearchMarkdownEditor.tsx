import {
  Bold,
  Code2,
  Eye,
  EyeOff,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { NetSearchMarkdownPreview } from './NetSearchMarkdownPreview'

interface NetSearchMarkdownEditorProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly maxLength: number
  readonly placeholder: string
}

interface EditorSnapshot {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

const HISTORY_LIMIT = 12
const HISTORY_DEBOUNCE_MS = 650
const PREVIEW_DEBOUNCE_MS = 550

function MarkdownToolbarButton({
  label,
  icon,
  onClick,
}: {
  readonly label: string
  readonly icon: ReactNode
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  )
}

export function NetSearchMarkdownEditor({
  value,
  onChange,
  maxLength,
  placeholder,
}: NetSearchMarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const historyRef = useRef<EditorSnapshot[]>([{ value, selectionStart: 0, selectionEnd: 0 }])
  const historyIndexRef = useRef(0)
  const historyTimerRef = useRef<number | null>(null)
  const lastEmittedValueRef = useRef<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewValue, setPreviewValue] = useState('')

  const clearHistoryTimer = useCallback(() => {
    if (historyTimerRef.current === null) return
    window.clearTimeout(historyTimerRef.current)
    historyTimerRef.current = null
  }, [])

  const currentSelection = (): Pick<EditorSnapshot, 'selectionStart' | 'selectionEnd'> => ({
    selectionStart: textareaRef.current?.selectionStart ?? 0,
    selectionEnd: textareaRef.current?.selectionEnd ?? 0,
  })

  const pushSnapshot = (snapshot: EditorSnapshot) => {
    const current = historyRef.current[historyIndexRef.current]
    if (current?.value === snapshot.value) {
      historyRef.current[historyIndexRef.current] = snapshot
      return
    }
    const next = historyRef.current.slice(0, historyIndexRef.current + 1)
    next.push(snapshot)
    if (next.length > HISTORY_LIMIT) next.shift()
    historyRef.current = next
    historyIndexRef.current = next.length - 1
  }

  const emitValue = (snapshot: EditorSnapshot) => {
    lastEmittedValueRef.current = snapshot.value
    onChange(snapshot.value)
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd)
    })
  }

  const scheduleHistorySnapshot = (snapshot: EditorSnapshot) => {
    clearHistoryTimer()
    historyTimerRef.current = window.setTimeout(() => {
      pushSnapshot(snapshot)
      historyTimerRef.current = null
    }, HISTORY_DEBOUNCE_MS)
  }

  useEffect(() => {
    if (lastEmittedValueRef.current === value) {
      lastEmittedValueRef.current = null
      return
    }
    clearHistoryTimer()
    historyRef.current = [{ value, selectionStart: 0, selectionEnd: 0 }]
    historyIndexRef.current = 0
  }, [clearHistoryTimer, value])

  useEffect(() => () => clearHistoryTimer(), [clearHistoryTimer])

  useEffect(() => {
    if (!previewOpen) return
    const timer = window.setTimeout(() => setPreviewValue(value), PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [previewOpen, value])

  const commitEdit = (snapshot: EditorSnapshot) => {
    if (snapshot.value.length > maxLength || snapshot.value === value) return
    clearHistoryTimer()
    const selection = currentSelection()
    pushSnapshot({ value, ...selection })
    pushSnapshot(snapshot)
    emitValue(snapshot)
  }

  const wrapSelection = (prefix: string, suffix: string, emptyText: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const { selectionStart, selectionEnd } = textarea
    const selected = value.slice(selectionStart, selectionEnd)
    const inner = selected || emptyText
    const replacement = `${prefix}${inner}${suffix}`
    const nextValue = `${value.slice(0, selectionStart)}${replacement}${value.slice(selectionEnd)}`
    const innerStart = selectionStart + prefix.length
    commitEdit({
      value: nextValue,
      selectionStart: innerStart,
      selectionEnd: innerStart + inner.length,
    })
  }

  const transformSelectedLines = (
    transform: (lines: readonly string[]) => readonly string[],
  ) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const { selectionStart, selectionEnd } = textarea
    const blockStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1
    const adjustedEnd = selectionEnd > selectionStart && value[selectionEnd - 1] === '\n'
      ? selectionEnd - 1
      : selectionEnd
    const nextLineBreak = value.indexOf('\n', adjustedEnd)
    const blockEnd = nextLineBreak < 0 ? value.length : nextLineBreak
    const transformed = transform(value.slice(blockStart, blockEnd).split('\n')).join('\n')
    commitEdit({
      value: `${value.slice(0, blockStart)}${transformed}${value.slice(blockEnd)}`,
      selectionStart: blockStart,
      selectionEnd: blockStart + transformed.length,
    })
  }

  const toggleHeading = (level: 1 | 2 | 3) => {
    const marker = `${'#'.repeat(level)} `
    transformSelectedLines((lines) => {
      const alreadyApplied = lines.every((line) => line.length === 0 || line.startsWith(marker))
      return lines.map((line) => {
        const plainLine = line.replace(/^\s{0,3}#{1,6}\s+/, '')
        return alreadyApplied ? plainLine : `${marker}${plainLine}`
      })
    })
  }

  const toggleLinePrefix = (kind: 'bullet' | 'number' | 'quote') => {
    const matcher = kind === 'bullet' ? /^\s*[-*+]\s+/ : kind === 'number' ? /^\s*\d+\.\s+/ : /^\s*>\s?/
    transformSelectedLines((lines) => {
      const nonEmpty = lines.filter((line) => line.trim().length > 0)
      const alreadyApplied = nonEmpty.length > 0 && nonEmpty.every((line) => matcher.test(line))
      let itemNumber = 0
      return lines.map((line) => {
        if (line.trim().length === 0 && lines.length > 1) return line
        itemNumber += 1
        const plainLine = line.replace(matcher, '')
        if (alreadyApplied) return plainLine
        if (kind === 'number') return `${itemNumber}. ${plainLine}`
        return `${kind === 'bullet' ? '- ' : '> '}${plainLine}`
      })
    })
  }

  const insertLink = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const { selectionStart, selectionEnd } = textarea
    const label = value.slice(selectionStart, selectionEnd) || 'link text'
    const destination = 'https://'
    const replacement = `[${label}](${destination})`
    const nextValue = `${value.slice(0, selectionStart)}${replacement}${value.slice(selectionEnd)}`
    const destinationStart = selectionStart + label.length + 3
    commitEdit({
      value: nextValue,
      selectionStart: destinationStart,
      selectionEnd: destinationStart + destination.length,
    })
  }

  const insertDivider = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const insertion = '\n\n---\n\n'
    const nextValue = `${value.slice(0, textarea.selectionStart)}${insertion}${value.slice(textarea.selectionEnd)}`
    const cursor = textarea.selectionStart + insertion.length
    commitEdit({ value: nextValue, selectionStart: cursor, selectionEnd: cursor })
  }

  const undo = () => {
    clearHistoryTimer()
    const selection = currentSelection()
    if (historyRef.current[historyIndexRef.current]?.value !== value) {
      pushSnapshot({ value, ...selection })
    }
    if (historyIndexRef.current <= 0) return
    historyIndexRef.current -= 1
    emitValue(historyRef.current[historyIndexRef.current])
  }

  const redo = () => {
    clearHistoryTimer()
    if (historyIndexRef.current >= historyRef.current.length - 1) return
    historyIndexRef.current += 1
    emitValue(historyRef.current[historyIndexRef.current])
  }

  const handleKeyboard = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return
    const key = event.key.toLocaleLowerCase()
    if (key !== 'z' && key !== 'y') return
    event.preventDefault()
    if (key === 'y' || event.shiftKey) redo()
    else undo()
  }

  return (
    <div className="net-search-markdown-editor">
      <div className="net-search-markdown-editor__toolbar" role="toolbar" aria-label="Lore Markdown formatting">
        <div>
          <MarkdownToolbarButton label="Bold" icon={<Bold size={14} />} onClick={() => wrapSelection('**', '**', 'bold text')} />
          <MarkdownToolbarButton label="Italic" icon={<Italic size={14} />} onClick={() => wrapSelection('*', '*', 'italic text')} />
          <MarkdownToolbarButton label="Inline code" icon={<Code2 size={14} />} onClick={() => wrapSelection('`', '`', 'code')} />
        </div>
        <div>
          <MarkdownToolbarButton label="Heading 1" icon={<Heading1 size={14} />} onClick={() => toggleHeading(1)} />
          <MarkdownToolbarButton label="Heading 2" icon={<Heading2 size={14} />} onClick={() => toggleHeading(2)} />
          <MarkdownToolbarButton label="Heading 3" icon={<Heading3 size={14} />} onClick={() => toggleHeading(3)} />
        </div>
        <div>
          <MarkdownToolbarButton label="Bullet list" icon={<List size={14} />} onClick={() => toggleLinePrefix('bullet')} />
          <MarkdownToolbarButton label="Numbered list" icon={<ListOrdered size={14} />} onClick={() => toggleLinePrefix('number')} />
          <MarkdownToolbarButton label="Quote" icon={<Quote size={14} />} onClick={() => toggleLinePrefix('quote')} />
          <MarkdownToolbarButton label="Link" icon={<Link size={14} />} onClick={insertLink} />
          <MarkdownToolbarButton label="Horizontal divider" icon={<Minus size={14} />} onClick={insertDivider} />
        </div>
        <div>
          <MarkdownToolbarButton label="Undo" icon={<Undo2 size={14} />} onClick={undo} />
          <MarkdownToolbarButton label="Redo" icon={<Redo2 size={14} />} onClick={redo} />
          <button
            type="button"
            className="net-search-markdown-editor__preview-toggle"
            aria-pressed={previewOpen}
            onClick={() => {
              if (previewOpen) {
                setPreviewOpen(false)
                setPreviewValue('')
              } else {
                setPreviewValue(value)
                setPreviewOpen(true)
              }
            }}
          >
            {previewOpen ? <EyeOff size={14} /> : <Eye size={14} />}
            {previewOpen ? 'Hide preview' : 'Formatted preview'}
          </button>
        </div>
      </div>

      <textarea
        ref={textareaRef}
        className="net-search-control__lore-content"
        value={value}
        onChange={(event) => {
          const snapshot = {
            value: event.target.value,
            selectionStart: event.target.selectionStart,
            selectionEnd: event.target.selectionEnd,
          }
          lastEmittedValueRef.current = snapshot.value
          onChange(snapshot.value)
          scheduleHistorySnapshot(snapshot)
        }}
        onKeyDown={handleKeyboard}
        maxLength={maxLength}
        rows={20}
        placeholder={placeholder}
        spellCheck
      />

      {previewOpen ? (
        <div className="net-search-markdown-editor__preview" aria-label="Formatted Markdown preview">
          <NetSearchMarkdownPreview content={previewValue} fallback="Preparing formatted preview…" />
        </div>
      ) : null}
    </div>
  )
}
