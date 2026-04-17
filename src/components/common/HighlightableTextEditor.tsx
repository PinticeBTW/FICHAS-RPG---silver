import { X } from 'lucide-react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type KeyboardEventHandler,
  type MouseEventHandler,
} from 'react'
import {
  buildHighlightClassName,
  getHighlightColorFromElement,
  normaliseNoteHtmlForEditor,
  normaliseNoteHtmlForStorage,
  type NoteHighlightColor,
} from '../../lib/noteRichText'

type ToolbarState = {
  left: number
  top: number
  placement: 'above' | 'below'
  targetHighlight?: HTMLElement | null
  activeColor?: NoteHighlightColor | null
}

interface HighlightableTextEditorProps {
  value: string
  onChange: (value: string) => void
  canEdit: boolean
  allowTextEditing?: boolean
  placeholder?: string
  className?: string
  editorClassName?: string
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>
}

const HIGHLIGHT_BUTTONS: { color: NoteHighlightColor; label: string }[] = [
  { color: 'yellow', label: 'Pista' },
  { color: 'red', label: 'Perigo' },
  { color: 'blue', label: 'Info' },
]

const TOOLBAR_HORIZONTAL_PADDING = 18
const TOOLBAR_VERTICAL_PADDING = 10
const TOOLBAR_OFFSET = 12
const TOOLBAR_ESTIMATED_WIDTH = 210
const TOOLBAR_ESTIMATED_HEIGHT = 52

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') {
    ref(value)
    return
  }

  if (ref) {
    ref.current = value
  }
}

function unwrapElement(element: HTMLElement) {
  const parent = element.parentNode

  if (!parent) {
    return
  }

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }

  parent.removeChild(element)
}

function findHighlightElement(node: Node | null, root: HTMLElement | null) {
  let current: Node | null = node

  while (current && root?.contains(current)) {
    if (current instanceof HTMLElement && getHighlightColorFromElement(current)) {
      return current
    }

    current = current.parentNode
  }

  return null
}

function removeNestedHighlights(fragment: DocumentFragment) {
  Array.from(fragment.querySelectorAll('span')).forEach((element) => {
    if (getHighlightColorFromElement(element)) {
      unwrapElement(element)
    }
  })
}

function mergeAdjacentHighlights(element: HTMLElement) {
  const color = getHighlightColorFromElement(element)

  if (!color) {
    return
  }

  let previous = element.previousSibling

  while (previous instanceof HTMLElement && getHighlightColorFromElement(previous) === color) {
    while (element.firstChild) {
      previous.appendChild(element.firstChild)
    }

    element.remove()
    element = previous
    previous = element.previousSibling
  }

  let next = element.nextSibling

  while (next instanceof HTMLElement && getHighlightColorFromElement(next) === color) {
    while (next.firstChild) {
      element.appendChild(next.firstChild)
    }

    const nextSibling = next.nextSibling
    next.remove()
    next = nextSibling
  }
}

function cleanupHighlights(root: HTMLElement) {
  Array.from(root.querySelectorAll('span')).forEach((element) => {
    const color = getHighlightColorFromElement(element)

    if (!color) {
      return
    }

    if (!element.textContent?.trim()) {
      element.remove()
      return
    }

    element.className = buildHighlightClassName(color)
    element.dataset.highlightColor = color

    const nestedHighlights = Array.from(element.querySelectorAll('span'))
    nestedHighlights.forEach((nested) => {
      if (nested === element) {
        return
      }

      const nestedColor = getHighlightColorFromElement(nested)

      if (nestedColor && nestedColor === color) {
        unwrapElement(nested)
      }
    })
  })

  root.normalize()
}

export const HighlightableTextEditor = forwardRef<HTMLDivElement, HighlightableTextEditorProps>(
  function HighlightableTextEditor(
    {
      value,
      onChange,
      canEdit,
      allowTextEditing = true,
      placeholder,
      className,
      editorClassName,
      onKeyDown,
    },
    forwardedRef,
  ) {
    const wrapperRef = useRef<HTMLDivElement | null>(null)
    const editorRef = useRef<HTMLDivElement | null>(null)
    const toolbarRef = useRef<HTMLDivElement | null>(null)
    const rangeRef = useRef<Range | null>(null)
    const [toolbar, setToolbar] = useState<ToolbarState | null>(null)

    const normalisedValue = useMemo(() => normaliseNoteHtmlForEditor(value), [value])

    const commitValue = useCallback(() => {
      const editor = editorRef.current

      if (!editor) {
        return
      }

      editor.dataset.empty = editor.textContent?.trim() ? 'false' : 'true'
      onChange(normaliseNoteHtmlForStorage(editor.innerHTML))
    }, [onChange])

    const hideToolbar = useCallback(() => {
      rangeRef.current = null
      setToolbar(null)
    }, [])

    const positionToolbar = useCallback((rect: DOMRect, targetHighlight?: HTMLElement | null) => {
      const wrapper = wrapperRef.current

      if (!wrapper) {
        return
      }

      const wrapperRect = wrapper.getBoundingClientRect()
      const preferredLeft = rect.left - wrapperRect.left + rect.width / 2
      const minLeft = TOOLBAR_HORIZONTAL_PADDING + TOOLBAR_ESTIMATED_WIDTH / 2
      const maxLeft = wrapperRect.width - TOOLBAR_HORIZONTAL_PADDING - TOOLBAR_ESTIMATED_WIDTH / 2
      const left =
        maxLeft <= minLeft
          ? wrapperRect.width / 2
          : Math.min(Math.max(preferredLeft, minLeft), maxLeft)

      const aboveTop = rect.top - wrapperRect.top - TOOLBAR_OFFSET
      const minTopForAbove = TOOLBAR_VERTICAL_PADDING + TOOLBAR_ESTIMATED_HEIGHT
      const shouldPlaceBelow = aboveTop < minTopForAbove

      setToolbar({
        left,
        top: shouldPlaceBelow
          ? rect.bottom - wrapperRect.top + TOOLBAR_OFFSET
          : aboveTop,
        placement: shouldPlaceBelow ? 'below' : 'above',
        targetHighlight,
        activeColor: getHighlightColorFromElement(targetHighlight ?? null),
      })
    }, [])

    const syncToolbarFromSelection = useCallback(() => {
      if (!canEdit) {
        hideToolbar()
        return
      }

      const selection = window.getSelection()
      const editor = editorRef.current

      if (!selection || !editor || !selection.rangeCount) {
        hideToolbar()
        return
      }

      const range = selection.getRangeAt(0)

      if (!editor.contains(range.commonAncestorContainer)) {
        hideToolbar()
        return
      }

      if (!selection.isCollapsed && range.toString().trim()) {
        rangeRef.current = range.cloneRange()
        positionToolbar(
          range.getBoundingClientRect(),
          findHighlightElement(range.commonAncestorContainer, editor),
        )
        return
      }

      const highlightElement = findHighlightElement(selection.anchorNode, editor)

      if (highlightElement) {
        rangeRef.current = null
        positionToolbar(highlightElement.getBoundingClientRect(), highlightElement)
        return
      }

      hideToolbar()
    }, [canEdit, hideToolbar, positionToolbar])

    useEffect(() => {
      const editor = editorRef.current

      if (!editor) {
        return
      }

      const currentNormalisedHtml = normaliseNoteHtmlForStorage(editor.innerHTML)
      const nextNormalisedHtml = normaliseNoteHtmlForStorage(normalisedValue)

      if (document.activeElement === editor && currentNormalisedHtml === nextNormalisedHtml) {
        editor.dataset.empty = editor.textContent?.trim() ? 'false' : 'true'
        return
      }

      if (editor.innerHTML !== normalisedValue) {
        editor.innerHTML = normalisedValue
      }

      editor.dataset.empty = editor.textContent?.trim() ? 'false' : 'true'
    }, [normalisedValue])

    useEffect(() => {
      const handleMouseDown = (event: MouseEvent) => {
        const target = event.target as Node | null

        if (toolbarRef.current?.contains(target) || wrapperRef.current?.contains(target)) {
          return
        }

        hideToolbar()
      }

      document.addEventListener('mousedown', handleMouseDown)

      return () => document.removeEventListener('mousedown', handleMouseDown)
    }, [hideToolbar])

    useEffect(() => {
      if (!canEdit) {
        return
      }

      const syncFromDocumentSelection = () => {
        window.requestAnimationFrame(() => {
          syncToolbarFromSelection()
        })
      }

      const syncFromViewportChange = () => {
        if (!toolbar) {
          return
        }

        syncToolbarFromSelection()
      }

      document.addEventListener('selectionchange', syncFromDocumentSelection)
      window.addEventListener('resize', syncFromViewportChange)
      window.addEventListener('scroll', syncFromViewportChange, true)

      return () => {
        document.removeEventListener('selectionchange', syncFromDocumentSelection)
        window.removeEventListener('resize', syncFromViewportChange)
        window.removeEventListener('scroll', syncFromViewportChange, true)
      }
    }, [canEdit, syncToolbarFromSelection, toolbar])

    const applyHighlight = useCallback((color: NoteHighlightColor) => {
      const editor = editorRef.current
      const selection = window.getSelection()
      const storedRange = rangeRef.current
      const targetHighlight = toolbar?.targetHighlight ?? null

      if (!editor || !selection) {
        return
      }

      if (targetHighlight && (!storedRange || selection.isCollapsed)) {
        targetHighlight.className = buildHighlightClassName(color)
        targetHighlight.dataset.highlightColor = color
        cleanupHighlights(editor)
        commitValue()
        positionToolbar(targetHighlight.getBoundingClientRect(), targetHighlight)
        return
      }

      if (!storedRange) {
        hideToolbar()
        return
      }

      selection.removeAllRanges()
      selection.addRange(storedRange)

      const range = selection.getRangeAt(0)

      if (range.collapsed || !range.toString().trim()) {
        hideToolbar()
        return
      }

      const wrapper = document.createElement('span')
      wrapper.className = buildHighlightClassName(color)
      wrapper.dataset.highlightColor = color

      const fragment = range.extractContents()
      removeNestedHighlights(fragment)
      wrapper.appendChild(fragment)
      range.insertNode(wrapper)

      mergeAdjacentHighlights(wrapper)
      cleanupHighlights(editor)
      commitValue()
      selection.removeAllRanges()
      positionToolbar(wrapper.getBoundingClientRect(), wrapper)
    }, [commitValue, hideToolbar, positionToolbar, toolbar?.targetHighlight])

    const removeHighlight = useCallback(() => {
      const editor = editorRef.current
      const target = toolbar?.targetHighlight

      if (!editor || !target) {
        hideToolbar()
        return
      }

      unwrapElement(target)
      cleanupHighlights(editor)
      commitValue()
      hideToolbar()
    }, [commitValue, hideToolbar, toolbar?.targetHighlight])

    const handleInput = useCallback(() => {
      commitValue()
      hideToolbar()
    }, [commitValue, hideToolbar])

    const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
      if (!allowTextEditing || !canEdit) {
        return
      }

      event.preventDefault()
      const pastedText = event.clipboardData.getData('text/plain')
      document.execCommand('insertText', false, pastedText)
      commitValue()
    }, [allowTextEditing, canEdit, commitValue])

    const handleMouseUp: MouseEventHandler<HTMLDivElement> = useCallback((event) => {
      if (!canEdit) {
        return
      }

      const clickedHighlight = findHighlightElement(event.target as Node, editorRef.current)

      window.setTimeout(() => {
        const selection = window.getSelection()

        if (selection?.isCollapsed && clickedHighlight) {
          rangeRef.current = null
          positionToolbar(clickedHighlight.getBoundingClientRect(), clickedHighlight)
          return
        }

        syncToolbarFromSelection()
      }, 0)
    }, [canEdit, positionToolbar, syncToolbarFromSelection])

    const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = useCallback((event) => {
      onKeyDown?.(event)
    }, [onKeyDown])

    const handleKeyUp: KeyboardEventHandler<HTMLDivElement> = useCallback(() => {
      window.setTimeout(() => {
        syncToolbarFromSelection()
      }, 0)
    }, [syncToolbarFromSelection])

    return (
      <div ref={wrapperRef} className={`relative ${className ?? ''}`}>
        <div
          ref={(node) => {
            editorRef.current = node
            assignRef(forwardedRef, node)
          }}
          contentEditable={allowTextEditing && canEdit}
          suppressContentEditableWarning
          spellCheck={false}
          data-placeholder={placeholder ?? ''}
          data-empty="true"
          onInput={allowTextEditing ? handleInput : undefined}
          onPaste={allowTextEditing ? handlePaste : undefined}
          onMouseUp={handleMouseUp}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          className={`highlightable-editor ${editorClassName ?? ''}`}
        />

        {toolbar ? (
          <div
            ref={toolbarRef}
            className="absolute z-20 flex items-center gap-1.5 rounded-full border border-[#1b5b88]/80 bg-[#050711]/96 px-2.5 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.5)] backdrop-blur-sm"
            style={{
              left: toolbar.left,
              top: toolbar.top,
              transform: toolbar.placement === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            {HIGHLIGHT_BUTTONS.map((button) => (
              <button
                key={button.color}
                type="button"
                onClick={() => applyHighlight(button.color)}
                className={`h-8 w-8 rounded-full border transition-transform duration-150 hover:scale-105 ${
                  toolbar.activeColor === button.color
                    ? 'border-white/60 shadow-[0_0_0_1px_rgba(255,255,255,0.25)]'
                    : 'border-white/10'
                } ${buildHighlightClassName(button.color)}`}
                title={button.label}
              />
            ))}

            {toolbar.targetHighlight ? (
              <button
                type="button"
                onClick={removeHighlight}
                className="signal-button inline-flex items-center gap-2 px-3 py-1.5 text-[0.68rem]"
                data-variant="ghost"
              >
                <X size={11} />
                Remover
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  },
)
