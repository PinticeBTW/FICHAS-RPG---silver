import {
  BellRing,
  Check,
  Eraser,
  Hand,
  ImagePlus,
  Italic,
  Music4,
  PencilLine,
  Pin,
  PinOff,
  Play,
  Plus,
  Search,
  StickyNote,
  Trash2,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'

type SilverReminder = {
  id: string
  title: string
  when: string
  notes: string
  done: boolean
  triggeredAt?: string
}

type SilverNotePage = {
  id: string
  title: string
  content: string
  pinned: boolean
  stickies: SilverSticky[]
  drawings: SilverStroke[]
}

type SilverStickyColor = 'amber' | 'cyan' | 'rose' | 'lime'
type SilverBoardItemKind = 'sticky' | 'text' | 'image'
type SilverBoardTool = 'pan' | 'draw' | 'erase'

type SilverStrokePoint = {
  x: number
  y: number
}

type SilverStroke = {
  id: string
  color: string
  width: number
  points: SilverStrokePoint[]
}

type SilverHistorySnapshot = {
  pagesValue: string
  activePageId: string
}

type SilverSticky = {
  id: string
  kind: SilverBoardItemKind
  title: string
  content: string
  x: number
  y: number
  color: SilverStickyColor
  imageData?: string
  imageWidth?: number
  imageHeight?: number
  width?: number
  height?: number
}

type SilverNotebookProps = {
  value: string
  pagesValue: string
  remindersValue: string
  onChange: (value: string) => void
  onPagesChange: (value: string) => void
  onRemindersChange: (value: string) => void
  canEdit: boolean
}
const REMINDER_SOUND_URL = '/sounds/silver-alert.mp3'
const STICKY_WIDTH_PX = 220
const STICKY_HEIGHT_PX = 164
const LEGACY_BOARD_WIDTH = 3600
const LEGACY_BOARD_HEIGHT = 2400
const MIN_ZOOM = 0.45
const MAX_ZOOM = 2.4
const DEFAULT_ZOOM = 1
const DRAW_COLOR = '#f3e600'
const DRAW_WIDTH = 3
const STICKY_COLOR_ORDER: SilverStickyColor[] = ['amber', 'cyan', 'rose', 'lime']
const STICKY_COLOR_CLASSES: Record<SilverStickyColor, string> = {
  amber: 'border-[#f3e600]/40 bg-[#f3e600]/12',
  cyan: 'border-sky-400/40 bg-sky-400/12',
  rose: 'border-rose-400/40 bg-rose-400/12',
  lime: 'border-lime-400/40 bg-lime-400/12',
}

function getBoardItemWidth(item: SilverSticky) {
  if (item.kind === 'image') {
    return Math.max(180, (item.imageWidth ?? 320) + 16)
  }
  if (item.width) return item.width
  if (item.kind === 'text') return 300
  return STICKY_WIDTH_PX
}

function getBoardItemMinHeight(item: SilverSticky) {
  if (item.kind === 'image') {
    return Math.max(180, (item.imageHeight ?? 180) + 70)
  }
  if (item.height) return item.height
  if (item.kind === 'text') return 210
  return STICKY_HEIGHT_PX
}

function buildDefaultPage(content = '', pageNumber = 1): SilverNotePage {
  return {
    id: crypto.randomUUID(),
    title: `Pagina ${pageNumber}`,
    content,
    pinned: false,
    stickies: [],
    drawings: [],
  }
}

function buildDefaultSticky(
  index: number,
  kind: SilverBoardItemKind = 'sticky',
  imageData = '',
  imageWidth?: number,
  imageHeight?: number,
): SilverSticky {
  const column = index % 3
  const row = Math.floor(index / 3)

  return {
    id: crypto.randomUUID(),
    kind,
    title:
      kind === 'image'
        ? `Imagem ${index + 1}`
        : kind === 'text'
          ? `Caixa ${index + 1}`
          : `Sticky ${index + 1}`,
    content: '',
    x: 140 + column * 270,
    y: 140 + row * 220,
    color: STICKY_COLOR_ORDER[index % STICKY_COLOR_ORDER.length],
    imageData: kind === 'image' ? imageData : undefined,
    imageWidth: kind === 'image' ? imageWidth : undefined,
    imageHeight: kind === 'image' ? imageHeight : undefined,
  }
}

function parseStickies(value: unknown): SilverSticky[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const sticky = entry as Record<string, unknown>

      const rawX = typeof sticky.x === 'number' ? sticky.x : 6
      const rawY = typeof sticky.y === 'number' ? sticky.y : 6
      const looksLegacyPercent =
        rawX >= 0 && rawX <= 100 && rawY >= 0 && rawY <= 100

      return {
        id: typeof sticky.id === 'string' ? sticky.id : crypto.randomUUID(),
        kind:
          sticky.kind === 'text' || sticky.kind === 'image' || sticky.kind === 'sticky'
            ? sticky.kind
            : 'sticky',
        title:
          typeof sticky.title === 'string' && sticky.title.trim()
            ? sticky.title
            : `Sticky ${index + 1}`,
        content: typeof sticky.content === 'string' ? sticky.content : '',
        x: looksLegacyPercent ? (rawX / 100) * LEGACY_BOARD_WIDTH : rawX,
        y: looksLegacyPercent ? (rawY / 100) * LEGACY_BOARD_HEIGHT : rawY,
        color: STICKY_COLOR_ORDER.includes(sticky.color as SilverStickyColor)
          ? (sticky.color as SilverStickyColor)
          : STICKY_COLOR_ORDER[index % STICKY_COLOR_ORDER.length],
        imageData: typeof sticky.imageData === 'string' ? sticky.imageData : undefined,
        imageWidth: typeof sticky.imageWidth === 'number' ? sticky.imageWidth : undefined,
        imageHeight: typeof sticky.imageHeight === 'number' ? sticky.imageHeight : undefined,
        width: typeof sticky.width === 'number' ? sticky.width : undefined,
        height: typeof sticky.height === 'number' ? sticky.height : undefined,
      }
    })
}

function readImageFileAsDataUrl(file: File) {
  return new Promise<{ dataUrl: string; width: number; height: number }>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''

      if (!dataUrl) {
        reject(new Error('Falha a ler a imagem.'))
        return
      }

      const image = new Image()
      image.onload = () =>
        resolve({
          dataUrl,
          width: image.naturalWidth,
          height: image.naturalHeight,
        })
      image.onerror = () => reject(new Error('Falha a ler a imagem.'))
      image.src = dataUrl
    }
    reader.onerror = () => reject(reader.error ?? new Error('Falha a ler a imagem.'))
    reader.readAsDataURL(file)
  })
}

function parseDrawings(value: unknown): SilverStroke[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const stroke = entry as Record<string, unknown>

      return {
        id: typeof stroke.id === 'string' ? stroke.id : crypto.randomUUID(),
        color: typeof stroke.color === 'string' ? stroke.color : DRAW_COLOR,
        width: typeof stroke.width === 'number' ? stroke.width : DRAW_WIDTH,
        points: Array.isArray(stroke.points)
          ? stroke.points
              .filter((point) => point && typeof point === 'object')
              .map((point) => {
                const safePoint = point as Record<string, unknown>

                return {
                  x: typeof safePoint.x === 'number' ? safePoint.x : 0,
                  y: typeof safePoint.y === 'number' ? safePoint.y : 0,
                }
              })
          : [],
      }
    })
    .filter((stroke) => stroke.points.length > 0)
}

function getDistanceToSegment(
  point: SilverStrokePoint,
  start: SilverStrokePoint,
  end: SilverStrokePoint,
) {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y

  if (deltaX === 0 && deltaY === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const projection =
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
    (deltaX * deltaX + deltaY * deltaY)
  const ratio = Math.max(0, Math.min(1, projection))
  const closestX = start.x + ratio * deltaX
  const closestY = start.y + ratio * deltaY

  return Math.hypot(point.x - closestX, point.y - closestY)
}

function findStrokeAtPoint(
  drawings: SilverStroke[],
  point: SilverStrokePoint,
  threshold: number,
) {
  for (let drawingIndex = drawings.length - 1; drawingIndex >= 0; drawingIndex -= 1) {
    const drawing = drawings[drawingIndex]

    for (let pointIndex = 1; pointIndex < drawing.points.length; pointIndex += 1) {
      const start = drawing.points[pointIndex - 1]
      const end = drawing.points[pointIndex]

      if (getDistanceToSegment(point, start, end) <= threshold) {
        return drawing.id
      }
    }

    if (drawing.points[0] && drawing.points.length === 1) {
      if (Math.hypot(point.x - drawing.points[0].x, point.y - drawing.points[0].y) <= threshold) {
        return drawing.id
      }
    }
  }

  return null
}

function parseNotePages(pagesValue: string, legacyValue: string): SilverNotePage[] {
  if (!pagesValue.trim()) {
    return [buildDefaultPage(legacyValue)]
  }

  try {
    const parsed = JSON.parse(pagesValue)

    if (!Array.isArray(parsed) || !parsed.length) {
      return [buildDefaultPage(legacyValue)]
    }

    const pages = parsed
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry, index) => {
        const page = entry as Record<string, unknown>

        return {
          id: typeof page.id === 'string' ? page.id : crypto.randomUUID(),
          title:
            typeof page.title === 'string' && page.title.trim()
              ? page.title
              : `Pagina ${index + 1}`,
          content: typeof page.content === 'string' ? page.content : '',
          pinned: Boolean(page.pinned),
          stickies: parseStickies(page.stickies),
          drawings: parseDrawings(page.drawings),
        }
      })

    return pages.length ? pages : [buildDefaultPage(legacyValue)]
  } catch {
    return [buildDefaultPage(legacyValue)]
  }
}

function serializeNotePages(pages: SilverNotePage[]) {
  return JSON.stringify(pages)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function normaliseNoteHtml(content: string) {
  if (!content.trim()) {
    return ''
  }

  const hasHtml = /<\/?[a-z][\s\S]*>/i.test(content)
  return hasHtml ? content : escapeHtml(content).replace(/\n/g, '<br>')
}

function normaliseStoredHtml(html: string) {
  const cleaned = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .trim()

  if (!cleaned || cleaned === '<br>' || cleaned === '<div><br></div>') {
    return ''
  }

  return cleaned
}

function parseReminders(value: string): SilverReminder[] {
  if (!value.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(value)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        id: typeof entry.id === 'string' ? entry.id : crypto.randomUUID(),
        title: typeof entry.title === 'string' ? entry.title : '',
        when: typeof entry.when === 'string' ? entry.when : '',
        notes: typeof entry.notes === 'string' ? entry.notes : '',
        done: Boolean(entry.done),
        triggeredAt: typeof entry.triggeredAt === 'string' ? entry.triggeredAt : undefined,
      }))
  } catch {
    return []
  }
}

function serializeReminders(reminders: SilverReminder[]) {
  return JSON.stringify(reminders)
}

function formatReminderWhen(value: string) {
  if (!value) {
    return 'Sem hora'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('pt-PT', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

async function playReminderAlert() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const audio = new Audio(REMINDER_SOUND_URL)
    audio.volume = 0.95
    await audio.play()
    return
  } catch {
    // Fallback para o bip interno se o ficheiro fixo nao existir ou o browser bloquear.
  }

  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioContextCtor) {
    return
  }

  const context = new AudioContextCtor()
  const gain = context.createGain()
  gain.connect(context.destination)
  gain.gain.setValueAtTime(0.0001, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.03)
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.55)

  const oscillator = context.createOscillator()
  oscillator.type = 'square'
  oscillator.frequency.setValueAtTime(880, context.currentTime)
  oscillator.frequency.setValueAtTime(660, context.currentTime + 0.18)
  oscillator.frequency.setValueAtTime(990, context.currentTime + 0.33)
  oscillator.connect(gain)
  oscillator.start()
  oscillator.stop(context.currentTime + 0.58)

  window.setTimeout(() => {
    void context.close()
  }, 900)
}

export function SilverNotebook({
  value,
  pagesValue,
  remindersValue,
  onChange,
  onPagesChange,
  onRemindersChange,
  canEdit,
}: SilverNotebookProps) {
  const notePages = useMemo(() => parseNotePages(pagesValue, value), [pagesValue, value])
  const reminders = useMemo(() => parseReminders(remindersValue), [remindersValue])
  const [activePageId, setActivePageId] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newWhen, setNewWhen] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [soundMessage, setSoundMessage] = useState('')
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now())
  const [draggingStickyId, setDraggingStickyId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [boardTool, setBoardTool] = useState<SilverBoardTool>('pan')
  const [draftStroke, setDraftStroke] = useState<SilverStroke | null>(null)
  const [undoStack, setUndoStack] = useState<SilverHistorySnapshot[]>([])
  const [redoStack, setRedoStack] = useState<SilverHistorySnapshot[]>([])
  const [camera, setCamera] = useState({
    x: 0,
    y: 0,
    zoom: DEFAULT_ZOOM,
  })
  const alertedIdsRef = useRef<Set<string>>(new Set())
  const editorRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const boardImageInputRef = useRef<HTMLInputElement | null>(null)
  const dragStateRef = useRef<{ stickyId: string; offsetX: number; offsetY: number } | null>(
    null,
  )
  const resizeStateRef = useRef<{
    stickyId: string
    startWidth: number
    startHeight: number
    aspectRatio: number
    startX: number
    startY: number
  } | null>(null)
  const panStateRef = useRef<{
    startX: number
    startY: number
    cameraX: number
    cameraY: number
  } | null>(null)
  const stickyResizeRef = useRef<{
    stickyId: string
    startW: number
    startH: number
    startX: number
    startY: number
  } | null>(null)
  const spaceHeldRef = useRef(false)
  const deleteSelectedStickyRef = useRef<(() => void) | null>(null)
  const [showNotesPanel, setShowNotesPanel] = useState(true)
  const [showRemindersPanel, setShowRemindersPanel] = useState(true)
  const drawStateRef = useRef<{
    strokeId: string
    points: SilverStrokePoint[]
  } | null>(null)
  const resolvedActivePageId = notePages.some((entry) => entry.id === activePageId)
    ? activePageId
    : (notePages[0]?.id ?? '')

  const activePage =
    notePages.find((entry) => entry.id === resolvedActivePageId) ??
    notePages[0] ??
    buildDefaultPage(value)

  const currentSnapshot = useMemo<SilverHistorySnapshot>(
    () => ({
      pagesValue,
      activePageId: resolvedActivePageId,
    }),
    [pagesValue, resolvedActivePageId],
  )

  useEffect(() => {
    if (!selectedItemId) {
      return
    }

    if (!activePage.stickies.some((sticky) => sticky.id === selectedItemId)) {
      setSelectedItemId(null)
    }
  }, [activePage.stickies, selectedItemId])

  useEffect(() => {
    setDraftStroke(null)
    drawStateRef.current = null
  }, [activePage.id])

  const pageOrder = useMemo(
    () => new Map(notePages.map((page, index) => [page.id, index])),
    [notePages],
  )

  const filteredPages = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    const visiblePages = query
      ? notePages.filter((page) => {
          const searchable = [
            page.title,
            stripHtml(page.content),
            ...page.stickies.map((sticky) => `${sticky.title} ${sticky.content}`),
          ]
            .join(' ')
            .toLowerCase()

          return searchable.includes(query)
        })
      : notePages

    return [...visiblePages].sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1
      }

      return (pageOrder.get(left.id) ?? 0) - (pageOrder.get(right.id) ?? 0)
    })
  }, [notePages, pageOrder, searchQuery])

  const sortedReminders = useMemo(
    () =>
      [...reminders].sort((left, right) => {
        const leftTime = left.when ? new Date(left.when).getTime() : Number.MAX_SAFE_INTEGER
        const rightTime = right.when ? new Date(right.when).getTime() : Number.MAX_SAFE_INTEGER
        return leftTime - rightTime
      }),
    [reminders],
  )

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTimestamp(Date.now())
    }, 5000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current

    if (!editor) {
      return
    }

    const nextHtml = normaliseNoteHtml(activePage.content)

    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml
    }
  }, [activePage.content, activePage.id])

  useEffect(() => {
    if (!canEdit) {
      return
    }

    const checkReminders = () => {
      const now = Date.now()
      const dueReminders = reminders.filter((entry) => {
        if (entry.done || entry.triggeredAt || !entry.when) {
          return false
        }

        const when = new Date(entry.when).getTime()
        return !Number.isNaN(when) && when <= now && !alertedIdsRef.current.has(entry.id)
      })

      if (!dueReminders.length) {
        return
      }

      dueReminders.forEach((entry) => alertedIdsRef.current.add(entry.id))
      void playReminderAlert()

      const updatedReminders = reminders.map((entry) =>
        dueReminders.some((dueEntry) => dueEntry.id === entry.id)
          ? { ...entry, triggeredAt: new Date().toISOString() }
          : entry,
      )

      onRemindersChange(serializeReminders(updatedReminders))
    }

    checkReminders()
    const timer = window.setInterval(checkReminders, 5000)

    return () => {
      window.clearInterval(timer)
    }
  }, [canEdit, onRemindersChange, reminders])

  const addReminder = () => {
    const trimmedTitle = newTitle.trim()

    if (!trimmedTitle) {
      return
    }

    const nextReminder: SilverReminder = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      when: newWhen,
      notes: newNotes.trim(),
      done: false,
    }

    onRemindersChange(serializeReminders([...reminders, nextReminder]))
    setNewTitle('')
    setNewWhen('')
    setNewNotes('')
  }

  const updateReminder = (reminderId: string, updater: (entry: SilverReminder) => SilverReminder) => {
    onRemindersChange(
      serializeReminders(reminders.map((entry) => (entry.id === reminderId ? updater(entry) : entry))),
    )
  }

  const removeReminder = (reminderId: string) => {
    onRemindersChange(serializeReminders(reminders.filter((entry) => entry.id !== reminderId)))
    alertedIdsRef.current.delete(reminderId)
  }

  const applySnapshot = useCallback((snapshot: SilverHistorySnapshot) => {
    const snapshotPages = parseNotePages(snapshot.pagesValue, value)
    const snapshotActivePageId = snapshotPages.some((entry) => entry.id === snapshot.activePageId)
      ? snapshot.activePageId
      : (snapshotPages[0]?.id ?? '')

    onPagesChange(snapshot.pagesValue)
    onChange(
      (
        snapshotPages.find((entry) => entry.id === snapshotActivePageId) ??
        snapshotPages[0]
      )?.content ?? '',
    )
    setActivePageId(snapshotActivePageId)
  }, [onChange, onPagesChange, value])

  const updatePages = useCallback((
    nextPages: SilverNotePage[],
    nextActivePageId?: string,
    options?: { skipHistory?: boolean },
  ) => {
    const nextSerialized = serializeNotePages(nextPages)
    const resolvedNextActivePageId = nextActivePageId ?? resolvedActivePageId
    const contentValue =
      (
        nextPages.find((entry) => entry.id === resolvedNextActivePageId) ??
        nextPages[0]
      )?.content ?? ''

    if (!options?.skipHistory) {
      setUndoStack((current) => {
        const lastEntry = current[current.length - 1]

        if (
          lastEntry?.pagesValue === currentSnapshot.pagesValue &&
          lastEntry.activePageId === currentSnapshot.activePageId
        ) {
          return current
        }

        return [...current.slice(-59), currentSnapshot]
      })
      setRedoStack([])
    }

    onPagesChange(nextSerialized)
    onChange(contentValue)
    setActivePageId(resolvedNextActivePageId)
  }, [currentSnapshot, onChange, onPagesChange, resolvedActivePageId])

  const undoPages = useCallback(() => {
    if (!undoStack.length) {
      return
    }

    const previousSnapshot = undoStack[undoStack.length - 1]!

    setUndoStack((current) => current.slice(0, -1))
    setRedoStack((current) => [...current.slice(-59), currentSnapshot])
    applySnapshot(previousSnapshot)
  }, [applySnapshot, currentSnapshot, undoStack])

  const redoPages = useCallback(() => {
    if (!redoStack.length) {
      return
    }

    const nextSnapshot = redoStack[redoStack.length - 1]!

    setRedoStack((current) => current.slice(0, -1))
    setUndoStack((current) => [...current.slice(-59), currentSnapshot])
    applySnapshot(nextSnapshot)
  }, [applySnapshot, currentSnapshot, redoStack])

  const updateActivePage = useCallback((updater: (page: SilverNotePage) => SilverNotePage) => {
    const nextPages = notePages.map((entry) =>
      entry.id === activePage.id ? updater(entry) : entry,
    )
    updatePages(nextPages, activePage.id)
  }, [activePage.id, notePages, updatePages])

  const createPage = () => {
    const nextPage = buildDefaultPage('', notePages.length + 1)

    updatePages([...notePages, nextPage], nextPage.id)
    setSearchQuery('')
  }

  const deletePage = (pageId: string) => {
    if (notePages.length <= 1) {
      const resetPage = buildDefaultPage('')
      updatePages([resetPage], resetPage.id)
      return
    }

    const nextPages = notePages.filter((entry) => entry.id !== pageId)
    updatePages(nextPages, nextPages[0]?.id)
  }

  const togglePinPage = (pageId: string) => {
    const nextPages = notePages.map((entry) =>
      entry.id === pageId ? { ...entry, pinned: !entry.pinned } : entry,
    )
    updatePages(nextPages, pageId)
  }

  const handleTestSound = () => {
    setSoundMessage('A testar o som do alerta...')
    void playReminderAlert()
  }

  const handleEditorInput = () => {
    const editor = editorRef.current

    if (!editor) {
      return
    }

    updateActivePage((page) => ({
      ...page,
      content: normaliseStoredHtml(editor.innerHTML),
    }))
  }

  const applyTextFormat = (command: 'italic') => {
    if (!canEdit) {
      return
    }

    editorRef.current?.focus()
    document.execCommand(command)
    handleEditorInput()
  }

  const handleEditorPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    const pastedText = event.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, pastedText)
    handleEditorInput()
  }

  const handleEditorShortcuts = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return
    }

    const key = event.key.toLowerCase()

    if (key === 'i') {
      event.preventDefault()
      applyTextFormat('italic')
    }
  }

  useEffect(() => {
    if (!canEdit) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTextContext =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable ||
        Boolean(target?.closest('[contenteditable="true"]'))

      // Delete/Backspace → delete the selected sticky (when not in a text field)
      if ((event.key === 'Delete' || event.key === 'Backspace') && !isTextContext) {
        if (deleteSelectedStickyRef.current) {
          event.preventDefault()
          deleteSelectedStickyRef.current()
        }
        return
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return
      }

      if (isTextContext || event.key.toLowerCase() !== 'z') {
        return
      }

      event.preventDefault()

      if (event.shiftKey) {
        redoPages()
        return
      }

      undoPages()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [canEdit, redoPages, undoPages])

  // Espaço = pan temporário (como Photoshop)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
        spaceHeldRef.current = true
        if (viewportRef.current) viewportRef.current.style.cursor = 'grab'
        e.preventDefault()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false
        if (viewportRef.current) viewportRef.current.style.cursor = ''
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const buildSpawnSticky = useCallback(
    (
      kind: SilverBoardItemKind = 'sticky',
      imageData = '',
      imageWidth?: number,
      imageHeight?: number,
    ): SilverSticky => {
      const nextIndex = activePage.stickies.length
      const baseSticky = buildDefaultSticky(nextIndex, kind, imageData, imageWidth, imageHeight)
      const viewportWidth = viewportRef.current?.clientWidth ?? 1200
      const viewportHeight = viewportRef.current?.clientHeight ?? 800

      return {
        ...baseSticky,
        x:
          camera.x +
          viewportWidth / (2 * camera.zoom) -
          getBoardItemWidth(baseSticky) / 2 +
          (nextIndex % 3) * 32,
        y:
          camera.y +
          viewportHeight / (2 * camera.zoom) -
          getBoardItemMinHeight(baseSticky) / 2 +
          Math.floor(nextIndex / 3) * 28,
      }
    },
    [activePage.stickies.length, camera.x, camera.y, camera.zoom],
  )

  const createSticky = () => {
    updateActivePage((page) => ({
      ...page,
      stickies: [...page.stickies, buildSpawnSticky('sticky')],
    }))
  }


  const updateSticky = useCallback((
    stickyId: string,
    updater: (sticky: SilverSticky) => SilverSticky,
  ) => {
    updateActivePage((page) => ({
      ...page,
      stickies: page.stickies.map((sticky) =>
        sticky.id === stickyId ? updater(sticky) : sticky,
      ),
    }))
  }, [updateActivePage])

  const deleteSticky = (stickyId: string) => {
    updateActivePage((page) => ({
      ...page,
      stickies: page.stickies.filter((sticky) => sticky.id !== stickyId),
    }))
  }

  // Always keep ref fresh so the keydown handler can call it without stale closure
  deleteSelectedStickyRef.current = selectedItemId ? () => deleteSticky(selectedItemId) : null

  // Resize de stickies (não-imagem)
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!stickyResizeRef.current) return
      const dw = (e.clientX - stickyResizeRef.current.startX) / camera.zoom
      const dh = (e.clientY - stickyResizeRef.current.startY) / camera.zoom
      updateSticky(stickyResizeRef.current.stickyId, (s) => ({
        ...s,
        width: Math.max(120, Math.round(stickyResizeRef.current!.startW + dw)),
        height: Math.max(80, Math.round(stickyResizeRef.current!.startH + dh)),
      }))
    }
    const handleUp = () => { stickyResizeRef.current = null }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [camera.zoom, updateSticky])

  const cycleStickyColor = (stickyId: string) => {
    updateSticky(stickyId, (sticky) => {
      const colorIndex = STICKY_COLOR_ORDER.indexOf(sticky.color)
      const nextColor =
        STICKY_COLOR_ORDER[(colorIndex + 1) % STICKY_COLOR_ORDER.length] ?? 'amber'

      return {
        ...sticky,
        color: nextColor,
      }
    })
  }

  const handleBoardImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      event.target.value = ''
      return
    }

      try {
      const imageMeta = await readImageFileAsDataUrl(file)
      updateActivePage((page) => ({
        ...page,
        stickies: [
          ...page.stickies,
          buildSpawnSticky('image', imageMeta.dataUrl, imageMeta.width, imageMeta.height),
        ],
      }))
    } catch {
      // Ignora silenciosamente; o Silver pode voltar a tentar.
    } finally {
      event.target.value = ''
    }
  }

  const startStickyDrag = (
    event: ReactMouseEvent<HTMLButtonElement>,
    sticky: SilverSticky,
  ) => {
    if (!canEdit || !viewportRef.current) {
      return
    }

    const viewportRect = viewportRef.current.getBoundingClientRect()
    const pointerWorldX = camera.x + (event.clientX - viewportRect.left) / camera.zoom
    const pointerWorldY = camera.y + (event.clientY - viewportRect.top) / camera.zoom

    dragStateRef.current = {
      stickyId: sticky.id,
      offsetX: pointerWorldX - sticky.x,
      offsetY: pointerWorldY - sticky.y,
    }

    setDraggingStickyId(sticky.id)
    event.preventDefault()
  }

  const handleBoardPanStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!viewportRef.current) {
      return
    }

    const target = event.target as HTMLElement

    if (target.closest('[data-board-item="true"]')) {
      return
    }

    setSelectedItemId(null)

    // Espaço segurado = pan temporário independente do tool
    if (spaceHeldRef.current) {
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing'
      panStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        cameraX: camera.x,
        cameraY: camera.y,
      }
      const onMove = (e: MouseEvent) => {
        if (!panStateRef.current) return
        const dx = (e.clientX - panStateRef.current.startX) / camera.zoom
        const dy = (e.clientY - panStateRef.current.startY) / camera.zoom
        setCamera((c) => ({ ...c, x: panStateRef.current!.cameraX - dx, y: panStateRef.current!.cameraY - dy }))
      }
      const onUp = () => {
        panStateRef.current = null
        if (viewportRef.current) viewportRef.current.style.cursor = spaceHeldRef.current ? 'grab' : ''
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      event.preventDefault()
      return
    }

    if (boardTool === 'erase' && canEdit) {
      const viewportRect = viewportRef.current.getBoundingClientRect()
      const point = {
        x: camera.x + (event.clientX - viewportRect.left) / camera.zoom,
        y: camera.y + (event.clientY - viewportRect.top) / camera.zoom,
      }
      const targetStrokeId = findStrokeAtPoint(
        activePage.drawings,
        point,
        16 / camera.zoom,
      )

      if (targetStrokeId) {
        updateActivePage((page) => ({
          ...page,
          drawings: page.drawings.filter((stroke) => stroke.id !== targetStrokeId),
        }))
      }

      event.preventDefault()
      return
    }

    if (boardTool === 'draw' && canEdit) {
      const viewportRect = viewportRef.current.getBoundingClientRect()
      const startPoint = {
        x: camera.x + (event.clientX - viewportRect.left) / camera.zoom,
        y: camera.y + (event.clientY - viewportRect.top) / camera.zoom,
      }
      const strokeId = crypto.randomUUID()

      drawStateRef.current = {
        strokeId,
        points: [startPoint],
      }
      setDraftStroke({
        id: strokeId,
        color: DRAW_COLOR,
        width: DRAW_WIDTH,
        points: [startPoint],
      })

      const handleMove = (moveEvent: MouseEvent) => {
        if (!drawStateRef.current || !viewportRef.current) {
          return
        }

        const drawViewportRect = viewportRef.current.getBoundingClientRect()
        const nextPoint = {
          x: camera.x + (moveEvent.clientX - drawViewportRect.left) / camera.zoom,
          y: camera.y + (moveEvent.clientY - drawViewportRect.top) / camera.zoom,
        }
        const lastPoint =
          drawStateRef.current.points[drawStateRef.current.points.length - 1] ?? nextPoint

        if (
          Math.abs(nextPoint.x - lastPoint.x) < 0.8 &&
          Math.abs(nextPoint.y - lastPoint.y) < 0.8
        ) {
          return
        }

        const nextPoints = [...drawStateRef.current.points, nextPoint]
        drawStateRef.current = {
          strokeId,
          points: nextPoints,
        }
        setDraftStroke((current) =>
          current
            ? {
                ...current,
                points: nextPoints,
              }
            : current,
        )
      }

      const handleUp = () => {
        const finishedStroke = drawStateRef.current
        drawStateRef.current = null

        if (finishedStroke?.points.length) {
          const points =
            finishedStroke.points.length === 1
              ? [
                  finishedStroke.points[0],
                  {
                    x: finishedStroke.points[0]!.x + 0.01,
                    y: finishedStroke.points[0]!.y + 0.01,
                  },
                ]
              : finishedStroke.points

          updateActivePage((page) => ({
            ...page,
            drawings: [
              ...page.drawings,
              {
                id: finishedStroke.strokeId,
                color: DRAW_COLOR,
                width: DRAW_WIDTH,
                points,
              },
            ],
          }))
        }

        setDraftStroke(null)
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
      event.preventDefault()
      return
    }

    panStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      cameraX: camera.x,
      cameraY: camera.y,
    }

    const handleMove = (moveEvent: MouseEvent) => {
      if (!panStateRef.current) {
        return
      }

      const deltaX = (moveEvent.clientX - panStateRef.current.startX) / camera.zoom
      const deltaY = (moveEvent.clientY - panStateRef.current.startY) / camera.zoom

      setCamera((current) => ({
        ...current,
        x: panStateRef.current ? panStateRef.current.cameraX - deltaX : current.x,
        y: panStateRef.current ? panStateRef.current.cameraY - deltaY : current.y,
      }))
    }

    const handleUp = () => {
      panStateRef.current = null
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }

  const startImageResize = (
    event: ReactMouseEvent<HTMLButtonElement>,
    sticky: SilverSticky,
  ) => {
    if (!canEdit || sticky.kind !== 'image') {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setSelectedItemId(sticky.id)

    const startWidth = sticky.imageWidth ?? 320
    const startHeight = sticky.imageHeight ?? 180

    resizeStateRef.current = {
      stickyId: sticky.id,
      startWidth,
      startHeight,
      aspectRatio: startWidth / Math.max(startHeight, 1),
      startX: event.clientX,
      startY: event.clientY,
    }
  }

  const startStickyResize = (event: ReactMouseEvent<HTMLButtonElement>, sticky: SilverSticky) => {
    if (!canEdit) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedItemId(sticky.id)
    stickyResizeRef.current = {
      stickyId: sticky.id,
      startW: getBoardItemWidth(sticky),
      startH: getBoardItemMinHeight(sticky),
      startX: event.clientX,
      startY: event.clientY,
    }
  }

  const handleViewportWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!viewportRef.current) {
      return
    }

    event.preventDefault()

    // Shift+scroll = pan horizontal, else zoom
    if (event.shiftKey) {
      setCamera((current) => ({
        ...current,
        x: current.x + event.deltaY / current.zoom,
      }))
      return
    }

    const viewport = viewportRef.current
    const rect = viewport.getBoundingClientRect()
    const pointerOffsetX = event.clientX - rect.left
    const pointerOffsetY = event.clientY - rect.top
    const pointerWorldX = camera.x + pointerOffsetX / camera.zoom
    const pointerWorldY = camera.y + pointerOffsetY / camera.zoom
    const nextZoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Number((camera.zoom - event.deltaY * 0.0012).toFixed(3))),
    )

    if (nextZoom === camera.zoom) {
      return
    }

    setCamera(() => ({
      x: pointerWorldX - pointerOffsetX / nextZoom,
      y: pointerWorldY - pointerOffsetY / nextZoom,
      zoom: nextZoom,
    }))
  }

  useEffect(() => {
    if (!draggingStickyId) {
      return
    }

    const handleMove = (event: MouseEvent) => {
      if (!dragStateRef.current || !viewportRef.current) {
        return
      }

      const viewportRect = viewportRef.current.getBoundingClientRect()
      const worldX = camera.x + (event.clientX - viewportRect.left) / camera.zoom
      const worldY = camera.y + (event.clientY - viewportRect.top) / camera.zoom
      const nextX = Number((worldX - dragStateRef.current.offsetX).toFixed(2))
      const nextY = Number((worldY - dragStateRef.current.offsetY).toFixed(2))

      updateSticky(draggingStickyId, (sticky) => ({
        ...sticky,
        x: nextX,
        y: nextY,
      }))
    }

    const handleUp = () => {
      dragStateRef.current = null
      setDraggingStickyId(null)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [camera.x, camera.y, camera.zoom, draggingStickyId, updateSticky])

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!resizeStateRef.current) {
        return
      }

      const deltaX = (event.clientX - resizeStateRef.current.startX) / camera.zoom
      const deltaY = (event.clientY - resizeStateRef.current.startY) / camera.zoom
      const widthFromX = resizeStateRef.current.startWidth + deltaX
      const widthFromY =
        resizeStateRef.current.startWidth +
        deltaY * resizeStateRef.current.aspectRatio
      const nextWidth = Math.max(90, Math.round(Math.max(widthFromX, widthFromY)))
      const nextHeight = Math.max(
        90,
        Math.round(nextWidth / resizeStateRef.current.aspectRatio),
      )

      updateSticky(resizeStateRef.current.stickyId, (sticky) => ({
        ...sticky,
        imageWidth: nextWidth,
        imageHeight: nextHeight,
      }))
    }

    const handleUp = () => {
      resizeStateRef.current = null
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [camera.zoom, updateSticky])

  const visibleDrawings = draftStroke
    ? [...activePage.drawings, draftStroke]
    : activePage.drawings

  return (
    <section className="hud-panel rounded-[28px] p-3 md:p-4">
      <div className="relative min-h-[calc(100vh-56px)] overflow-hidden rounded-[28px] border border-white/10 bg-[#050505]">
        <div
          ref={viewportRef}
          onMouseDown={handleBoardPanStart}
          onWheel={handleViewportWheel}
          className={`absolute inset-0 overflow-hidden ${
            boardTool === 'draw'
              ? 'cursor-crosshair'
              : boardTool === 'erase'
                ? 'cursor-cell'
              : 'cursor-grab active:cursor-grabbing'
          }`}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(circle, rgba(243,230,0,0.12) 1.1px, transparent 1.1px), linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)',
              backgroundPosition: `${-camera.x * camera.zoom}px ${-camera.y * camera.zoom}px, ${-camera.x * camera.zoom}px ${-camera.y * camera.zoom}px, ${-camera.x * camera.zoom}px ${-camera.y * camera.zoom}px`,
              backgroundSize: `${26 * camera.zoom}px ${26 * camera.zoom}px, ${130 * camera.zoom}px ${130 * camera.zoom}px, ${130 * camera.zoom}px ${130 * camera.zoom}px`,
            }}
          />

          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
            {visibleDrawings.map((stroke) => (
              <polyline
                key={stroke.id}
                fill="none"
                stroke={stroke.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={stroke.width * camera.zoom}
                points={stroke.points
                  .map(
                    (point) =>
                      `${(point.x - camera.x) * camera.zoom},${(point.y - camera.y) * camera.zoom}`,
                  )
                  .join(' ')}
              />
            ))}
          </svg>

            {activePage.stickies.length || visibleDrawings.length ? (
              activePage.stickies.map((sticky) => (
                <article
                  key={sticky.id}
                  data-board-item="true"
                  onMouseDown={() => setSelectedItemId(sticky.id)}
                  className={`absolute border p-2 shadow-[0_10px_24px_rgba(0,0,0,0.28)] ${
                    sticky.kind === 'text'
                      ? 'border-white/20 bg-black/60'
                      : sticky.kind === 'image'
                        ? 'border-white/20 bg-black/70'
                        : STICKY_COLOR_CLASSES[sticky.color]
                  } ${
                    selectedItemId === sticky.id
                      ? 'ring-1 ring-[#f3e600]/65'
                      : ''
                  } ${draggingStickyId === sticky.id ? 'cursor-grabbing' : ''}`}
                  style={{
                    transform: `translate(${(sticky.x - camera.x) * camera.zoom}px, ${(sticky.y - camera.y) * camera.zoom}px) scale(${camera.zoom})`,
                    transformOrigin: 'top left',
                    width: `${getBoardItemWidth(sticky)}px`,
                    minHeight: `${getBoardItemMinHeight(sticky)}px`,
                  }}
                >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onMouseDown={(event) => startStickyDrag(event, sticky)}
                    disabled={!canEdit}
                    className="signal-button cursor-grab px-2 py-1 text-[0.65rem]"
                    data-variant="ghost"
                    title="Arrastar"
                  >
                    mover
                  </button>

                  {sticky.kind !== 'image' ? (
                    <button
                      type="button"
                      onClick={() => cycleStickyColor(sticky.id)}
                      disabled={!canEdit}
                      className="signal-button px-2 py-1 text-[0.65rem]"
                      data-variant="ghost"
                      title="Mudar cor"
                    >
                      cor
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); deleteSticky(sticky.id) }}
                    disabled={!canEdit}
                    className="signal-button ml-auto px-2 py-1 text-[0.65rem]"
                    data-tone="danger"
                    title="Apagar"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>

                <input
                  type="text"
                  value={sticky.title}
                  readOnly={!canEdit}
                  onChange={(event) =>
                    updateSticky(sticky.id, (entry) => ({
                      ...entry,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Titulo"
                  className="mt-2 w-full border border-white/15 bg-black/15 px-2 py-1 text-xs font-semibold text-white outline-none focus:border-white/35"
                />

                  {sticky.kind === 'image' ? (
                    <div className="relative mt-2">
                      {sticky.imageData ? (
                        <>
                          <img
                            src={sticky.imageData}
                            alt={sticky.title}
                            className="block h-auto w-full"
                          />
                          {selectedItemId === sticky.id ? (
                            <button
                              type="button"
                              onMouseDown={(event) => startImageResize(event, sticky)}
                              className="absolute bottom-0 right-0 h-4 w-4 translate-x-1/2 translate-y-1/2 border border-[#f3e600] bg-black shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                              title="Redimensionar imagem"
                            />
                          ) : null}
                        </>
                      ) : (
                        <div className="flex h-[160px] items-center justify-center border border-white/15 bg-black/15 text-xs text-stone-500">
                          Sem imagem
                        </div>
                      )}
                    </div>
                  ) : (
                    <textarea
                      value={sticky.content}
                      readOnly={!canEdit}
                      onChange={(event) =>
                        updateSticky(sticky.id, (entry) => ({
                          ...entry,
                          content: event.target.value,
                        }))
                      }
                      placeholder={sticky.kind === 'text' ? 'Texto livre...' : 'Escreve aqui...'}
                      className="mt-2 min-h-[110px] w-full resize-none border border-white/15 bg-black/15 px-2 py-2 text-xs leading-5 text-stone-100 outline-none focus:border-white/35"
                    />
                  )}
                  {selectedItemId === sticky.id && sticky.kind !== 'image' && canEdit ? (
                    <button
                      type="button"
                      onMouseDown={(e) => startStickyResize(e, sticky)}
                      className="absolute bottom-0 right-0 h-4 w-4 translate-x-1/2 translate-y-1/2 border border-[#f3e600] bg-black shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                      title="Redimensionar"
                    />
                  ) : null}
                </article>
              ))
            ) : (
            <div className="absolute left-1/2 top-1/2 w-[420px] -translate-x-1/2 -translate-y-1/2 border border-white/10 bg-black/55 px-6 py-5 text-center shadow-[0_18px_38px_rgba(0,0,0,0.35)]">
              <p className="panel-title">Quadro vazio</p>
              <p className="mt-3 text-sm leading-7 text-stone-400">
                Cria stickies, caixas de texto, imagens e paginas para montar o espaco do Silver como quiseres.
              </p>
            </div>
          )}
        </div>

        <div className="pointer-events-none absolute inset-0">
          {showNotesPanel ? (
          <div className="pointer-events-auto absolute left-4 top-4 flex max-h-[calc(100%-120px)] w-[330px] flex-col rounded-[22px] border border-white/10 bg-[#0b0b0b]/95 p-3 shadow-[0_14px_32px_rgba(0,0,0,0.4)] backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="panel-title">Quadro do Silver</p>
                <p className="mt-2 text-xs leading-6 text-stone-500">
                  Pesquisa paginas, fixa as mais importantes e escreve o rascunho rapido desta pagina.
                </p>
              </div>

              <button
                type="button"
                onClick={() => togglePinPage(activePage.id)}
                disabled={!canEdit}
                className="signal-button inline-flex items-center gap-2 px-3 py-2 text-xs"
                data-variant="ghost"
                title={activePage.pinned ? 'Desafixar pagina' : 'Fixar pagina'}
              >
                {activePage.pinned ? <PinOff size={13} /> : <Pin size={13} />}
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                value={activePage.title}
                readOnly={!canEdit}
                onChange={(event) =>
                  updateActivePage((page) => ({
                    ...page,
                    title: event.target.value,
                  }))
                }
                placeholder="Titulo da pagina"
                className="min-w-0 flex-1 border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-[#f3e600]/45"
              />

              <button
                type="button"
                onClick={createPage}
                disabled={!canEdit}
                className="signal-button inline-flex items-center gap-2 px-3 py-2 text-xs"
                title="Nova pagina"
              >
                <Plus size={13} />
              </button>
            </div>

            <div className="relative mt-3">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Pesquisar paginas, notas ou stickies"
                className="w-full border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-[#f3e600]/45"
              />
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="space-y-2">
                {filteredPages.length ? (
                  filteredPages.map((page) => {
                    const selected = page.id === resolvedActivePageId

                    return (
                      <div
                        key={page.id}
                        className={`border px-3 py-2 transition ${
                          selected
                            ? 'border-[#f3e600] bg-[#f3e600]/10'
                            : 'border-white/10 bg-black/25'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => setActivePageId(page.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold text-white">{page.title}</p>
                              {page.pinned ? <Pin size={11} className="shrink-0 text-[#f3e600]" /> : null}
                            </div>
                            <p className="mt-1 text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                              {page.stickies.length} bloco{page.stickies.length === 1 ? '' : 's'}
                            </p>
                          </button>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => togglePinPage(page.id)}
                              disabled={!canEdit}
                              className="p-1 text-stone-600 transition hover:text-[#f3e600]"
                              title={page.pinned ? 'Desafixar pagina' : 'Fixar pagina'}
                            >
                              {page.pinned ? <PinOff size={11} /> : <Pin size={11} />}
                            </button>

                            {notePages.length > 1 ? (
                              <button
                                type="button"
                                onClick={() => deletePage(page.id)}
                                disabled={!canEdit}
                                className="p-1 text-stone-600 transition hover:text-rose-400"
                                title="Apagar pagina"
                              >
                                <Trash2 size={11} />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <p className="py-5 text-center text-xs text-stone-500">
                    Nada encontrado nessa pesquisa.
                  </p>
                )}
              </div>

              <div className="mt-4 border border-white/10 bg-black/30 p-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => applyTextFormat('italic')}
                    disabled={!canEdit}
                    className="signal-button inline-flex items-center gap-2 px-3 py-1.5 text-xs"
                    data-variant="ghost"
                    title="Italico"
                  >
                    <Italic size={13} />
                    I
                  </button>

                  <p className="text-xs text-stone-500">Ctrl+I para italico.</p>
                </div>

                <div
                  ref={editorRef}
                  contentEditable={canEdit}
                  suppressContentEditableWarning
                  onInput={handleEditorInput}
                  onPaste={handleEditorPaste}
                  onKeyDown={handleEditorShortcuts}
                  data-placeholder="Rascunho rapido desta pagina..."
                  className="mt-3 min-h-[220px] w-full overflow-y-auto border border-white/10 bg-black/30 px-4 py-4 font-mono text-sm leading-7 text-stone-100 outline-none transition empty:before:pointer-events-none empty:before:text-stone-600 empty:before:content-[attr(data-placeholder)] focus:border-[#f3e600]/45 [&_em]:italic [&_i]:italic"
                />
              </div>
            </div>
          </div>
          ) : null}

          {showRemindersPanel ? (
          <div className="pointer-events-auto absolute right-4 top-4 flex max-h-[calc(100%-120px)] w-[320px] flex-col gap-3">
            <div className="rounded-[22px] border border-white/10 bg-[#0b0b0b]/95 p-3 shadow-[0_14px_32px_rgba(0,0,0,0.4)] backdrop-blur">
              <div className="flex items-center gap-2">
                <BellRing size={16} className="text-[#f3e600]" />
                <p className="panel-title">Lembretes</p>
              </div>

              <div className="mt-3 border border-white/10 bg-black/30 p-3">
                <div className="flex items-center gap-2">
                  <Music4 size={14} className="text-[#f3e600]" />
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-300">
                    Som do alerta
                  </p>
                </div>

                <p className="mt-2 text-xs leading-6 text-stone-500">
                  Mete o ficheiro em <span className="text-stone-300">public/sounds</span> com o nome <span className="text-stone-300">silver-alert.mp3</span>.
                </p>

                <button
                  type="button"
                  onClick={handleTestSound}
                  className="signal-button mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs"
                  data-variant="ghost"
                >
                  <Play size={13} />
                  Testar som
                </button>

                <p className="mt-3 text-xs text-stone-400">
                  {soundMessage || `Som fixo: ${REMINDER_SOUND_URL}`}
                </p>
              </div>

              <div className="mt-3 space-y-2">
                <input
                  type="text"
                  value={newTitle}
                  readOnly={!canEdit}
                  onChange={(event) => setNewTitle(event.target.value)}
                  placeholder="Titulo do lembrete"
                  className="w-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#f3e600]/45"
                />

                <input
                  type="datetime-local"
                  value={newWhen}
                  readOnly={!canEdit}
                  onChange={(event) => setNewWhen(event.target.value)}
                  className="w-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#f3e600]/45"
                />

                <textarea
                  value={newNotes}
                  readOnly={!canEdit}
                  onChange={(event) => setNewNotes(event.target.value)}
                  placeholder="Notas rapidas"
                  className="min-h-[90px] w-full resize-none border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#f3e600]/45"
                />

                <button
                  type="button"
                  onClick={addReminder}
                  disabled={!canEdit}
                  className="signal-button inline-flex items-center gap-2 px-3 py-2 text-xs"
                >
                  <Plus size={13} />
                  Adicionar lembrete
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-[22px] border border-white/10 bg-[#0b0b0b]/95 p-3 shadow-[0_14px_32px_rgba(0,0,0,0.4)] backdrop-blur">
              <p className="panel-title">Agenda</p>

              <div className="mt-3 space-y-2">
                {sortedReminders.length ? (
                  sortedReminders.map((reminder) => {
                    const due =
                      !reminder.done &&
                      reminder.when &&
                      !Number.isNaN(new Date(reminder.when).getTime()) &&
                      new Date(reminder.when).getTime() <= nowTimestamp

                    return (
                      <div
                        key={reminder.id}
                        className={`border px-3 py-3 ${
                          reminder.done
                            ? 'border-emerald-500/25 bg-emerald-500/10'
                            : due
                              ? 'border-amber-400/40 bg-amber-400/10'
                              : 'border-white/10 bg-black/25'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">{reminder.title}</p>
                            <p className="mt-1 text-xs text-stone-400">
                              {formatReminderWhen(reminder.when)}
                            </p>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                updateReminder(reminder.id, (entry) => ({
                                  ...entry,
                                  done: !entry.done,
                                }))
                              }
                              className="signal-button px-2 py-1 text-xs"
                              data-variant={reminder.done ? undefined : 'ghost'}
                            >
                              <Check size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeReminder(reminder.id)}
                              className="signal-button px-2 py-1 text-xs"
                              data-tone="danger"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>

                        {reminder.notes ? (
                          <p className="mt-2 text-xs leading-6 text-stone-300">{reminder.notes}</p>
                        ) : null}
                      </div>
                    )
                  })
                ) : (
                  <p className="py-4 text-sm text-stone-500">Ainda nao tens lembretes.</p>
                )}
              </div>
            </div>
          </div>
          ) : null}

          <div className="pointer-events-auto absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-[#0b0b0b]/95 px-3 py-3 shadow-[0_14px_32px_rgba(0,0,0,0.4)] backdrop-blur">
            <div className="border-r border-white/10 pr-3 text-right">
              <p className="text-[0.65rem] uppercase tracking-[0.18em] text-stone-500">
                Scroll
              </p>
              <p className="text-xs font-semibold text-white">{Math.round(camera.zoom * 100)}%</p>
            </div>

            <button
              type="button"
              onClick={() => setBoardTool('pan')}
              className="signal-button inline-flex items-center gap-2 px-4 py-2 text-xs"
              data-variant={boardTool === 'pan' ? undefined : 'ghost'}
            >
              <Hand size={13} />
              Mover
            </button>

            <button
              type="button"
              onClick={() => setBoardTool('draw')}
              className="signal-button inline-flex items-center gap-2 px-4 py-2 text-xs"
              data-variant={boardTool === 'draw' ? undefined : 'ghost'}
            >
              <PencilLine size={13} />
              Caneta
            </button>

            <button
              type="button"
              onClick={() => setBoardTool('erase')}
              className="signal-button inline-flex items-center gap-2 px-4 py-2 text-xs"
              data-variant={boardTool === 'erase' ? undefined : 'ghost'}
            >
              <Eraser size={13} />
              Borracha
            </button>

            <button
              type="button"
              onClick={createSticky}
              disabled={!canEdit}
              className="signal-button inline-flex items-center gap-2 px-4 py-2 text-xs"
            >
              <StickyNote size={13} />
              Sticky
            </button>

            <button
              type="button"
              onClick={() => boardImageInputRef.current?.click()}
              disabled={!canEdit}
              className="signal-button inline-flex items-center gap-2 px-4 py-2 text-xs"
              data-variant="ghost"
            >
              <ImagePlus size={13} />
              Imagem
            </button>

            <div className="mx-1 h-5 w-px bg-white/10" />

            <button
              type="button"
              onClick={() => setShowNotesPanel((v) => !v)}
              className="signal-button inline-flex items-center gap-2 px-3 py-2 text-xs"
              data-variant={showNotesPanel ? undefined : 'ghost'}
              title="Mostrar/esconder Quadro"
            >
              Quadro
            </button>

            <button
              type="button"
              onClick={() => setShowRemindersPanel((v) => !v)}
              className="signal-button inline-flex items-center gap-2 px-3 py-2 text-xs"
              data-variant={showRemindersPanel ? undefined : 'ghost'}
              title="Mostrar/esconder Lembretes"
            >
              <BellRing size={13} />
              Lembretes
            </button>

          </div>

          <input
            ref={boardImageInputRef}
            type="file"
            accept="image/*"
            onChange={(event) => void handleBoardImageUpload(event)}
            className="hidden"
          />
        </div>
      </div>
    </section>
  )
}
