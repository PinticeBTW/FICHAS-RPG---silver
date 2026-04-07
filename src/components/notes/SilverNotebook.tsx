import {
  BellRing,
  Check,
  ChevronLeft,
  ChevronRight,
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
  Save,
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
import type { SilverMessageRecipientOption } from '../../lib/playerInbox'
import { PdfSheetPreview } from '../character/PdfSheetEditor'
import { SilverMessageComposerPanel } from './PlayerMessagesPanel'

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
type SilverBoardItemKind = 'sticky' | 'text' | 'image' | 'sheet'
type SilverBoardTool = 'pan' | 'draw' | 'erase'

export type SilverBoardProfileSummary = {
  profileId: string
  displayName: string
  subtitle: string
  hpCurrent: string
  hpMax: string
  psCurrent: string
  psMax: string
  peCurrent: string
  peMax: string
  defense: string
  block: string
  karma: string
  updatedAt: string
}

export type SilverBoardInsertRequest = {
  profileId: string
  nonce: string
}

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

type SilverDragState = {
  stickyId: string
  offsetX: number
  offsetY: number
  originPositions: Record<string, SilverStrokePoint>
  historyCaptured: boolean
  historySnapshot: SilverHistorySnapshot
}

type SilverDrawingDragState = {
  startX: number
  startY: number
  originPoints: Record<string, SilverStrokePoint[]>
  historyCaptured: boolean
  historySnapshot: SilverHistorySnapshot
}

type SilverSelectionBox = {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

type SilverMarqueeState = {
  startX: number
  startY: number
  baseSelectionIds: string[]
  baseDrawingSelectionIds: string[]
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
  linkedProfileId?: string
  sheetPage?: number
}

type SilverNotebookProps = {
  value: string
  pagesValue: string
  remindersValue: string
  workspaceStorageKey?: string
  onChange: (value: string) => void
  onPagesChange: (value: string) => void
  onRemindersChange: (value: string) => void
  canEdit: boolean
  onQuickSave?: () => void
  canQuickSave?: boolean
  quickSaveBusy?: boolean
  boardProfiles?: SilverBoardProfileSummary[]
  boardProfileFieldData?: Record<string, Record<string, string>>
  pendingBoardProfileCard?: SilverBoardInsertRequest | null
  playerMessageRecipients?: SilverMessageRecipientOption[]
  onSendPlayerMessage?: (recipientId: string, title: string, body: string) => Promise<void> | void
  sendingPlayerMessage?: boolean
  playerMessageError?: string | null
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
const SILVER_NOTEBOOK_UI_KEY = 'silver-notebook-ui'
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
  if (item.kind === 'sheet') {
    return item.width ?? 300
  }
  if (item.width) return item.width
  if (item.kind === 'text') return 300
  return STICKY_WIDTH_PX
}

function getBoardItemMinHeight(item: SilverSticky) {
  if (item.kind === 'image') {
    return Math.max(180, (item.imageHeight ?? 180) + 70)
  }
  if (item.kind === 'sheet') {
    return item.height ?? 318
  }
  if (item.height) return item.height
  if (item.kind === 'text') return 210
  return STICKY_HEIGHT_PX
}

function dedupeItemIds(ids: string[]) {
  const seen = new Set<string>()
  const uniqueIds: string[] = []

  ids.forEach((id) => {
    if (!id || seen.has(id)) {
      return
    }

    seen.add(id)
    uniqueIds.push(id)
  })

  return uniqueIds
}

function areItemIdsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((id, index) => id === right[index])
}

function getSelectionBounds(selectionBox: SilverSelectionBox) {
  const left = Math.min(selectionBox.startX, selectionBox.currentX)
  const top = Math.min(selectionBox.startY, selectionBox.currentY)
  const right = Math.max(selectionBox.startX, selectionBox.currentX)
  const bottom = Math.max(selectionBox.startY, selectionBox.currentY)

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }
}

function doesStickyIntersectSelection(sticky: SilverSticky, selectionBox: SilverSelectionBox) {
  const bounds = getSelectionBounds(selectionBox)
  const itemLeft = sticky.x
  const itemTop = sticky.y
  const itemRight = sticky.x + getBoardItemWidth(sticky)
  const itemBottom = sticky.y + getBoardItemMinHeight(sticky)

  return (
    itemRight >= bounds.left &&
    itemLeft <= bounds.right &&
    itemBottom >= bounds.top &&
    itemTop <= bounds.bottom
  )
}

function doesStrokeIntersectSelection(stroke: SilverStroke, selectionBox: SilverSelectionBox) {
  const bounds = getSelectionBounds(selectionBox)
  const strokeXs = stroke.points.map((point) => point.x)
  const strokeYs = stroke.points.map((point) => point.y)
  const strokeLeft = Math.min(...strokeXs) - stroke.width / 2
  const strokeTop = Math.min(...strokeYs) - stroke.width / 2
  const strokeRight = Math.max(...strokeXs) + stroke.width / 2
  const strokeBottom = Math.max(...strokeYs) + stroke.width / 2

  return (
    strokeRight >= bounds.left &&
    strokeLeft <= bounds.right &&
    strokeBottom >= bounds.top &&
    strokeTop <= bounds.bottom
  )
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
        : kind === 'sheet'
          ? `Ficha ${index + 1}`
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

function parseStoredTitle(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function parseMetricValue(value: string) {
  const normalized = value.trim().replace(',', '.')

  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function getMetricPercent(current: string, max: string) {
  const currentValue = parseMetricValue(current)
  const maxValue = parseMetricValue(max)

  if (currentValue === null || maxValue === null || maxValue <= 0) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round((currentValue / maxValue) * 100)))
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
      const parsedKind: SilverBoardItemKind =
        sticky.kind === 'text' ||
        sticky.kind === 'image' ||
        sticky.kind === 'sheet' ||
        sticky.kind === 'sticky'
          ? sticky.kind
          : 'sticky'
      const fallbackTitle =
        parsedKind === 'image'
          ? `Imagem ${index + 1}`
          : parsedKind === 'sheet'
            ? `Ficha ${index + 1}`
            : parsedKind === 'text'
              ? `Caixa ${index + 1}`
              : `Sticky ${index + 1}`

      return {
        id: typeof sticky.id === 'string' ? sticky.id : crypto.randomUUID(),
        kind: parsedKind,
        title: parseStoredTitle(sticky.title, fallbackTitle),
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
        linkedProfileId:
          typeof sticky.linkedProfileId === 'string' ? sticky.linkedProfileId : undefined,
        sheetPage: typeof sticky.sheetPage === 'number' ? sticky.sheetPage : undefined,
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
          title: parseStoredTitle(page.title, `Pagina ${index + 1}`),
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

function readStoredPanelPreference(workspaceStorageKey: string | undefined, panel: 'notes' | 'reminders') {
  if (typeof window === 'undefined') {
    return true
  }

  const storageKey = `${SILVER_NOTEBOOK_UI_KEY}:${workspaceStorageKey ?? 'global'}:${panel}`
  return window.localStorage.getItem(storageKey) !== '0'
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
  workspaceStorageKey,
  onChange,
  onPagesChange,
  onRemindersChange,
  canEdit,
  onQuickSave,
  canQuickSave = false,
  quickSaveBusy = false,
  boardProfiles = [],
  boardProfileFieldData = {},
  pendingBoardProfileCard = null,
  playerMessageRecipients = [],
  onSendPlayerMessage,
  sendingPlayerMessage = false,
  playerMessageError = null,
}: SilverNotebookProps) {
  const notePages = useMemo(() => parseNotePages(pagesValue, value), [pagesValue, value])
  const reminders = useMemo(() => parseReminders(remindersValue), [remindersValue])
  const boardProfilesById = useMemo(
    () => new Map(boardProfiles.map((entry) => [entry.profileId, entry])),
    [boardProfiles],
  )
  const [activePageId, setActivePageId] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newWhen, setNewWhen] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [soundMessage, setSoundMessage] = useState('')
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now())
  const [draggingStickyId, setDraggingStickyId] = useState<string | null>(null)
  const [draggingDrawingId, setDraggingDrawingId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [selectedDrawingIds, setSelectedDrawingIds] = useState<string[]>([])
  const [boardTool, setBoardTool] = useState<SilverBoardTool>('pan')
  const [draftStroke, setDraftStroke] = useState<SilverStroke | null>(null)
  const [selectionBox, setSelectionBox] = useState<SilverSelectionBox | null>(null)
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
  const dragStateRef = useRef<SilverDragState | null>(null)
  const drawingDragStateRef = useRef<SilverDrawingDragState | null>(null)
  const resizeStateRef = useRef<{
    stickyId: string
    startWidth: number
    startHeight: number
    aspectRatio: number
    startX: number
    startY: number
    historyCaptured: boolean
    historySnapshot: SilverHistorySnapshot
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
    historyCaptured: boolean
    historySnapshot: SilverHistorySnapshot
  } | null>(null)
  const marqueeStateRef = useRef<SilverMarqueeState | null>(null)
  const spaceHeldRef = useRef(false)
  const bodyUserSelectRef = useRef<string | null>(null)
  const bodyWebkitUserSelectRef = useRef<string | null>(null)
  const deleteSelectedStickyRef = useRef<(() => void) | null>(null)
  const handledBoardInsertRequestRef = useRef<string | null>(null)
  const [showNotesPanel, setShowNotesPanel] = useState(() =>
    readStoredPanelPreference(workspaceStorageKey, 'notes'),
  )
  const [showRemindersPanel, setShowRemindersPanel] = useState(() =>
    readStoredPanelPreference(workspaceStorageKey, 'reminders'),
  )
  const [previewSheetStickyId, setPreviewSheetStickyId] = useState<string | null>(null)
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
  const previewSheetSticky =
    activePage.stickies.find(
      (entry) => entry.id === previewSheetStickyId && entry.kind === 'sheet',
    ) ?? null
  const previewSheetFieldData =
    previewSheetSticky?.linkedProfileId
      ? boardProfileFieldData[previewSheetSticky.linkedProfileId]
      : undefined
  const previewSheetProfile =
    previewSheetSticky?.linkedProfileId
      ? boardProfilesById.get(previewSheetSticky.linkedProfileId)
      : undefined
  const previewSheetPage = Math.min(4, Math.max(1, previewSheetSticky?.sheetPage ?? 1))
  const selectedItemIdsSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])
  const selectedDrawingIdsSet = useMemo(() => new Set(selectedDrawingIds), [selectedDrawingIds])
  const currentSnapshot = useMemo<SilverHistorySnapshot>(
    () => ({
      pagesValue,
      activePageId: resolvedActivePageId,
    }),
    [pagesValue, resolvedActivePageId],
  )

  const replaceSelection = useCallback((nextIds: string[], nextPrimaryId?: string | null) => {
    const uniqueIds = dedupeItemIds(nextIds)
    const resolvedPrimaryId =
      nextPrimaryId && uniqueIds.includes(nextPrimaryId)
        ? nextPrimaryId
        : (uniqueIds[uniqueIds.length - 1] ?? null)

    setSelectedItemIds((current) => (areItemIdsEqual(current, uniqueIds) ? current : uniqueIds))
    setSelectedItemId((current) => (current === resolvedPrimaryId ? current : resolvedPrimaryId))
  }, [])

  const replaceDrawingSelection = useCallback((nextIds: string[], nextPrimaryId?: string | null) => {
    const uniqueIds = dedupeItemIds(nextIds)
    const resolvedPrimaryId =
      nextPrimaryId && uniqueIds.includes(nextPrimaryId)
        ? nextPrimaryId
        : (uniqueIds[uniqueIds.length - 1] ?? null)

    setSelectedDrawingIds((current) => (areItemIdsEqual(current, uniqueIds) ? current : uniqueIds))
    setSelectedDrawingId((current) => (current === resolvedPrimaryId ? current : resolvedPrimaryId))
  }, [])

  const clearSelection = useCallback(() => {
    replaceSelection([], null)
    replaceDrawingSelection([], null)
  }, [replaceDrawingSelection, replaceSelection])

  const selectSingleItem = useCallback((stickyId: string) => {
    replaceSelection([stickyId], stickyId)
    replaceDrawingSelection([], null)
  }, [replaceDrawingSelection, replaceSelection])

  const selectSingleDrawing = useCallback((strokeId: string) => {
    replaceDrawingSelection([strokeId], strokeId)
    replaceSelection([], null)
  }, [replaceDrawingSelection, replaceSelection])

  const toggleItemSelection = useCallback((stickyId: string) => {
    if (selectedItemIds.includes(stickyId)) {
      const nextIds = selectedItemIds.filter((id) => id !== stickyId)
      const nextPrimaryId =
        selectedItemId === stickyId ? (nextIds[nextIds.length - 1] ?? null) : selectedItemId

      replaceSelection(nextIds, nextPrimaryId)
      return
    }

    replaceSelection([...selectedItemIds, stickyId], stickyId)
  }, [replaceSelection, selectedItemId, selectedItemIds])

  const toggleDrawingSelection = useCallback((strokeId: string) => {
    if (selectedDrawingIds.includes(strokeId)) {
      const nextIds = selectedDrawingIds.filter((id) => id !== strokeId)
      const nextPrimaryId =
        selectedDrawingId === strokeId ? (nextIds[nextIds.length - 1] ?? null) : selectedDrawingId

      replaceDrawingSelection(nextIds, nextPrimaryId)
      return
    }

    replaceDrawingSelection([...selectedDrawingIds, strokeId], strokeId)
  }, [replaceDrawingSelection, selectedDrawingId, selectedDrawingIds])

  const lockDocumentSelection = useCallback(() => {
    if (typeof document === 'undefined') {
      return
    }

    if (bodyUserSelectRef.current === null) {
      bodyUserSelectRef.current = document.body.style.userSelect
      bodyWebkitUserSelectRef.current = document.body.style.webkitUserSelect
    }

    document.body.style.userSelect = 'none'
    document.body.style.webkitUserSelect = 'none'
  }, [])

  const unlockDocumentSelection = useCallback(() => {
    if (typeof document === 'undefined') {
      return
    }

    document.body.style.userSelect = bodyUserSelectRef.current ?? ''
    document.body.style.webkitUserSelect = bodyWebkitUserSelectRef.current ?? ''
    bodyUserSelectRef.current = null
    bodyWebkitUserSelectRef.current = null
  }, [])

  const handleStickyMouseDown = useCallback((
    event: ReactMouseEvent<HTMLElement>,
    stickyId: string,
  ) => {
    if (event.button !== 0) {
      return
    }

    if (event.shiftKey) {
      event.preventDefault()
      toggleItemSelection(stickyId)
      return
    }

    if (selectedItemIdsSet.has(stickyId)) {
      if (selectedDrawingIds.length) {
        replaceDrawingSelection([], null)
      }
      if (selectedItemId !== stickyId) {
        setSelectedItemId(stickyId)
      }
      return
    }

    selectSingleItem(stickyId)
  }, [
    replaceDrawingSelection,
    selectSingleItem,
    selectedDrawingIds.length,
    selectedItemId,
    selectedItemIdsSet,
    toggleItemSelection,
  ])

  const handleDrawingMouseDown = useCallback((
    event: ReactMouseEvent<SVGPolylineElement>,
    stroke: SilverStroke,
  ) => {
    if (event.button !== 0 || boardTool !== 'pan') {
      return
    }

    if (event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      toggleDrawingSelection(stroke.id)
      return
    }

    if (selectedDrawingIdsSet.has(stroke.id)) {
      if (selectedItemIds.length) {
        replaceSelection([], null)
      }
      if (selectedDrawingId !== stroke.id) {
        setSelectedDrawingId(stroke.id)
      }
    } else {
      selectSingleDrawing(stroke.id)
    }

    event.preventDefault()
    event.stopPropagation()

    if (!canEdit || !viewportRef.current) {
      return
    }

    const viewportRect = viewportRef.current.getBoundingClientRect()
    const startX = camera.x + (event.clientX - viewportRect.left) / camera.zoom
    const startY = camera.y + (event.clientY - viewportRect.top) / camera.zoom
    const drawingIdsToMove = selectedDrawingIdsSet.has(stroke.id) ? selectedDrawingIds : [stroke.id]
    const originPoints = Object.fromEntries(
      activePage.drawings
        .filter((entry) => drawingIdsToMove.includes(entry.id))
        .map((entry) => [entry.id, entry.points.map((point) => ({ ...point }))]),
    )

    drawingDragStateRef.current = {
      startX,
      startY,
      originPoints,
      historyCaptured: false,
      historySnapshot: currentSnapshot,
    }
    lockDocumentSelection()
    setDraggingDrawingId(stroke.id)
  }, [
    activePage.drawings,
    boardTool,
    camera.x,
    camera.y,
    camera.zoom,
    canEdit,
    currentSnapshot,
    lockDocumentSelection,
    replaceSelection,
    selectSingleDrawing,
    selectedDrawingId,
    selectedDrawingIds,
    selectedDrawingIdsSet,
    selectedItemIds.length,
    toggleDrawingSelection,
  ])

  useEffect(() => {
    const validIds = selectedItemIds.filter((stickyId) =>
      activePage.stickies.some((sticky) => sticky.id === stickyId),
    )
    const nextPrimaryId =
      selectedItemId && validIds.includes(selectedItemId)
        ? selectedItemId
        : (validIds[validIds.length - 1] ?? null)

    if (!areItemIdsEqual(validIds, selectedItemIds) || nextPrimaryId !== selectedItemId) {
      replaceSelection(validIds, nextPrimaryId)
    }
  }, [activePage.stickies, replaceSelection, selectedItemId, selectedItemIds])

  useEffect(() => {
    const validIds = selectedDrawingIds.filter((strokeId) =>
      activePage.drawings.some((stroke) => stroke.id === strokeId),
    )
    const nextPrimaryId =
      selectedDrawingId && validIds.includes(selectedDrawingId)
        ? selectedDrawingId
        : (validIds[validIds.length - 1] ?? null)

    if (!areItemIdsEqual(validIds, selectedDrawingIds) || nextPrimaryId !== selectedDrawingId) {
      replaceDrawingSelection(validIds, nextPrimaryId)
    }
  }, [activePage.drawings, replaceDrawingSelection, selectedDrawingId, selectedDrawingIds])

  useEffect(() => {
    if (!previewSheetStickyId) {
      return
    }

    if (!activePage.stickies.some((sticky) => sticky.id === previewSheetStickyId && sticky.kind === 'sheet')) {
      setPreviewSheetStickyId(null)
    }
  }, [activePage.stickies, previewSheetStickyId])

  useEffect(() => {
    setDraftStroke(null)
    drawStateRef.current = null
  }, [activePage.id])

  useEffect(() => () => {
    unlockDocumentSelection()
  }, [unlockDocumentSelection])

  useEffect(() => {
    setShowNotesPanel(readStoredPanelPreference(workspaceStorageKey, 'notes'))
    setShowRemindersPanel(readStoredPanelPreference(workspaceStorageKey, 'reminders'))
  }, [workspaceStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const storagePrefix = `${SILVER_NOTEBOOK_UI_KEY}:${workspaceStorageKey ?? 'global'}`
    window.localStorage.setItem(`${storagePrefix}:notes`, showNotesPanel ? '1' : '0')
    window.localStorage.setItem(`${storagePrefix}:reminders`, showRemindersPanel ? '1' : '0')
  }, [showNotesPanel, showRemindersPanel, workspaceStorageKey])

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

  const pushHistorySnapshot = useCallback((snapshot: SilverHistorySnapshot) => {
    setUndoStack((current) => {
      const lastEntry = current[current.length - 1]

      if (
        lastEntry?.pagesValue === snapshot.pagesValue &&
        lastEntry.activePageId === snapshot.activePageId
      ) {
        return current
      }

      return [...current.slice(-59), snapshot]
    })
    setRedoStack([])
  }, [])

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

  const updateActivePageWithoutHistory = useCallback((updater: (page: SilverNotePage) => SilverNotePage) => {
    const nextPages = notePages.map((entry) =>
      entry.id === activePage.id ? updater(entry) : entry,
    )
    updatePages(nextPages, activePage.id, { skipHistory: true })
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

  useEffect(() => {
    if (!pendingBoardProfileCard) {
      return
    }

    if (handledBoardInsertRequestRef.current === pendingBoardProfileCard.nonce) {
      return
    }

    handledBoardInsertRequestRef.current = pendingBoardProfileCard.nonce

    const linkedProfile = boardProfilesById.get(pendingBoardProfileCard.profileId)

    updateActivePage((page) => ({
      ...page,
      stickies: [
        ...page.stickies,
        {
          ...buildSpawnSticky('sheet'),
          title: linkedProfile?.displayName ?? 'Ficha ligada',
          linkedProfileId: pendingBoardProfileCard.profileId,
          sheetPage: 1,
          color: 'cyan',
        },
      ],
    }))
  }, [
    boardProfilesById,
    buildSpawnSticky,
    pendingBoardProfileCard,
    updateActivePage,
  ])


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

  const updateStickyWithoutHistory = useCallback((
    stickyId: string,
    updater: (sticky: SilverSticky) => SilverSticky,
  ) => {
    updateActivePageWithoutHistory((page) => ({
      ...page,
      stickies: page.stickies.map((sticky) =>
        sticky.id === stickyId ? updater(sticky) : sticky,
      ),
    }))
  }, [updateActivePageWithoutHistory])

  const deleteSelectedEntities = useCallback((stickyIds: string[], drawingIds: string[]) => {
    const stickiesToDelete = dedupeItemIds(stickyIds)
    const drawingsToDelete = dedupeItemIds(drawingIds)

    if (!stickiesToDelete.length && !drawingsToDelete.length) {
      return
    }

    const stickyIdsToDeleteSet = new Set(stickiesToDelete)
    const drawingIdsToDeleteSet = new Set(drawingsToDelete)

    updateActivePage((page) => ({
      ...page,
      stickies: page.stickies.filter((sticky) => !stickyIdsToDeleteSet.has(sticky.id)),
      drawings: page.drawings.filter((drawing) => !drawingIdsToDeleteSet.has(drawing.id)),
    }))
  }, [updateActivePage])

  const deleteSticky = (stickyId: string) => {
    updateActivePage((page) => ({
      ...page,
      stickies: page.stickies.filter((sticky) => sticky.id !== stickyId),
    }))
  }

  // Always keep ref fresh so the keydown handler can call it without stale closure
  deleteSelectedStickyRef.current = selectedItemIds.length || selectedDrawingIds.length
    ? () => deleteSelectedEntities(selectedItemIds, selectedDrawingIds)
    : null

  // Resize de stickies (não-imagem)
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!stickyResizeRef.current) return
      const dw = (e.clientX - stickyResizeRef.current.startX) / camera.zoom
      const dh = (e.clientY - stickyResizeRef.current.startY) / camera.zoom
      const nextWidth = Math.max(120, Math.round(stickyResizeRef.current.startW + dw))
      const nextHeight = Math.max(80, Math.round(stickyResizeRef.current.startH + dh))

      if (
        !stickyResizeRef.current.historyCaptured &&
        (nextWidth !== stickyResizeRef.current.startW || nextHeight !== stickyResizeRef.current.startH)
      ) {
        pushHistorySnapshot(stickyResizeRef.current.historySnapshot)
        stickyResizeRef.current.historyCaptured = true
      }

      updateStickyWithoutHistory(stickyResizeRef.current.stickyId, (s) => ({
        ...s,
        width: nextWidth,
        height: nextHeight,
      }))
    }
    const handleUp = () => {
      stickyResizeRef.current = null
      unlockDocumentSelection()
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [camera.zoom, pushHistorySnapshot, unlockDocumentSelection, updateStickyWithoutHistory])

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
    const selectionIdsToMove = selectedItemIdsSet.has(sticky.id) ? selectedItemIds : [sticky.id]
    const originPositions = Object.fromEntries(
      activePage.stickies
        .filter((entry) => selectionIdsToMove.includes(entry.id))
        .map((entry) => [entry.id, { x: entry.x, y: entry.y }]),
    )

    if (!selectedItemIdsSet.has(sticky.id)) {
      selectSingleItem(sticky.id)
    } else if (selectedItemId !== sticky.id) {
      setSelectedItemId(sticky.id)
    }

    dragStateRef.current = {
      stickyId: sticky.id,
      offsetX: pointerWorldX - sticky.x,
      offsetY: pointerWorldY - sticky.y,
      originPositions,
      historyCaptured: false,
      historySnapshot: currentSnapshot,
    }

    lockDocumentSelection()
    setDraggingStickyId(sticky.id)
    event.stopPropagation()
    event.preventDefault()
  }

  const handleBoardPanStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !viewportRef.current) {
      return
    }

    const target = event.target as HTMLElement

    if (target.closest('[data-board-item="true"]')) {
      return
    }

    // Espaço segurado = pan temporário independente do tool
    if (spaceHeldRef.current) {
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing'
      lockDocumentSelection()
      panStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        cameraX: camera.x,
        cameraY: camera.y,
      }
      const onMove = (e: MouseEvent) => {
        const panState = panStateRef.current

        if (!panState) {
          return
        }

        const dx = (e.clientX - panState.startX) / camera.zoom
        const dy = (e.clientY - panState.startY) / camera.zoom

        setCamera((current) => ({
          ...current,
          x: panState.cameraX - dx,
          y: panState.cameraY - dy,
        }))
      }
      const onUp = () => {
        panStateRef.current = null
        unlockDocumentSelection()
        if (viewportRef.current) viewportRef.current.style.cursor = spaceHeldRef.current ? 'grab' : ''
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      event.preventDefault()
      return
    }

    if (boardTool === 'pan' && event.shiftKey) {
      const viewportRect = viewportRef.current.getBoundingClientRect()
      const startPoint = {
        x: camera.x + (event.clientX - viewportRect.left) / camera.zoom,
        y: camera.y + (event.clientY - viewportRect.top) / camera.zoom,
      }
      const baseSelectionIds = [...selectedItemIds]
      const baseDrawingSelectionIds = [...selectedDrawingIds]

      marqueeStateRef.current = {
        startX: startPoint.x,
        startY: startPoint.y,
        baseSelectionIds,
        baseDrawingSelectionIds,
      }
      lockDocumentSelection()
      setSelectionBox({
        startX: startPoint.x,
        startY: startPoint.y,
        currentX: startPoint.x,
        currentY: startPoint.y,
      })

      const handleMove = (moveEvent: MouseEvent) => {
        if (!marqueeStateRef.current || !viewportRef.current) {
          return
        }

        const selectionViewportRect = viewportRef.current.getBoundingClientRect()
        const nextSelectionBox = {
          startX: marqueeStateRef.current.startX,
          startY: marqueeStateRef.current.startY,
          currentX: camera.x + (moveEvent.clientX - selectionViewportRect.left) / camera.zoom,
          currentY: camera.y + (moveEvent.clientY - selectionViewportRect.top) / camera.zoom,
        }
        const boxedIds = activePage.stickies
          .filter((sticky) => doesStickyIntersectSelection(sticky, nextSelectionBox))
          .map((sticky) => sticky.id)
        const boxedDrawingIds = activePage.drawings
          .filter((stroke) => doesStrokeIntersectSelection(stroke, nextSelectionBox))
          .map((stroke) => stroke.id)

        setSelectionBox(nextSelectionBox)
        replaceSelection([...marqueeStateRef.current.baseSelectionIds, ...boxedIds])
        replaceDrawingSelection([
          ...marqueeStateRef.current.baseDrawingSelectionIds,
          ...boxedDrawingIds,
        ])
      }

      const handleUp = () => {
        marqueeStateRef.current = null
        setSelectionBox(null)
        unlockDocumentSelection()
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
      event.preventDefault()
      return
    }

    clearSelection()

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
      lockDocumentSelection()
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

        unlockDocumentSelection()
        setDraftStroke(null)
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
      event.preventDefault()
      return
    }

    lockDocumentSelection()
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
      unlockDocumentSelection()
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    event.preventDefault()
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
    selectSingleItem(sticky.id)
    lockDocumentSelection()

    const startWidth = sticky.imageWidth ?? 320
    const startHeight = sticky.imageHeight ?? 180

    resizeStateRef.current = {
      stickyId: sticky.id,
      startWidth,
      startHeight,
      aspectRatio: startWidth / Math.max(startHeight, 1),
      startX: event.clientX,
      startY: event.clientY,
      historyCaptured: false,
      historySnapshot: currentSnapshot,
    }
  }

  const startStickyResize = (event: ReactMouseEvent<HTMLButtonElement>, sticky: SilverSticky) => {
    if (!canEdit || sticky.kind === 'sheet') return
    event.preventDefault()
    event.stopPropagation()
    selectSingleItem(sticky.id)
    lockDocumentSelection()
    stickyResizeRef.current = {
      stickyId: sticky.id,
      startW: getBoardItemWidth(sticky),
      startH: getBoardItemMinHeight(sticky),
      startX: event.clientX,
      startY: event.clientY,
      historyCaptured: false,
      historySnapshot: currentSnapshot,
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
      const nextAnchorX = Number((worldX - dragStateRef.current.offsetX).toFixed(2))
      const nextAnchorY = Number((worldY - dragStateRef.current.offsetY).toFixed(2))
      const anchorOrigin = dragStateRef.current.originPositions[dragStateRef.current.stickyId]

      if (!anchorOrigin) {
        return
      }

      const deltaX = nextAnchorX - anchorOrigin.x
      const deltaY = nextAnchorY - anchorOrigin.y

      if (!dragStateRef.current.historyCaptured && (deltaX !== 0 || deltaY !== 0)) {
        pushHistorySnapshot(dragStateRef.current.historySnapshot)
        dragStateRef.current.historyCaptured = true
      }

      updateActivePageWithoutHistory((page) => ({
        ...page,
        stickies: page.stickies.map((sticky) => {
          const origin = dragStateRef.current?.originPositions[sticky.id]

          if (!origin) {
            return sticky
          }

          return {
            ...sticky,
            x: Number((origin.x + deltaX).toFixed(2)),
            y: Number((origin.y + deltaY).toFixed(2)),
          }
        }),
      }))
    }

    const handleUp = () => {
      dragStateRef.current = null
      unlockDocumentSelection()
      setDraggingStickyId(null)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [
    camera.x,
    camera.y,
    camera.zoom,
    draggingStickyId,
    pushHistorySnapshot,
    unlockDocumentSelection,
    updateActivePageWithoutHistory,
  ])

  useEffect(() => {
    if (!draggingDrawingId) {
      return
    }

    const handleMove = (event: MouseEvent) => {
      if (!drawingDragStateRef.current || !viewportRef.current) {
        return
      }

      const viewportRect = viewportRef.current.getBoundingClientRect()
      const worldX = camera.x + (event.clientX - viewportRect.left) / camera.zoom
      const worldY = camera.y + (event.clientY - viewportRect.top) / camera.zoom
      const deltaX = worldX - drawingDragStateRef.current.startX
      const deltaY = worldY - drawingDragStateRef.current.startY

      if (!drawingDragStateRef.current.historyCaptured && (deltaX !== 0 || deltaY !== 0)) {
        pushHistorySnapshot(drawingDragStateRef.current.historySnapshot)
        drawingDragStateRef.current.historyCaptured = true
      }

      updateActivePageWithoutHistory((page) => ({
        ...page,
        drawings: page.drawings.map((stroke) => {
          const originPoints = drawingDragStateRef.current?.originPoints[stroke.id]

          if (!originPoints) {
            return stroke
          }

          return {
            ...stroke,
            points: originPoints.map((point) => ({
              x: Number((point.x + deltaX).toFixed(2)),
              y: Number((point.y + deltaY).toFixed(2)),
            })),
          }
        }),
      }))
    }

    const handleUp = () => {
      drawingDragStateRef.current = null
      unlockDocumentSelection()
      setDraggingDrawingId(null)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [
    camera.x,
    camera.y,
    camera.zoom,
    draggingDrawingId,
    pushHistorySnapshot,
    unlockDocumentSelection,
    updateActivePageWithoutHistory,
  ])

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

      if (
        !resizeStateRef.current.historyCaptured &&
        (nextWidth !== resizeStateRef.current.startWidth ||
          nextHeight !== resizeStateRef.current.startHeight)
      ) {
        pushHistorySnapshot(resizeStateRef.current.historySnapshot)
        resizeStateRef.current.historyCaptured = true
      }

      updateStickyWithoutHistory(resizeStateRef.current.stickyId, (sticky) => ({
        ...sticky,
        imageWidth: nextWidth,
        imageHeight: nextHeight,
      }))
    }

    const handleUp = () => {
      resizeStateRef.current = null
      unlockDocumentSelection()
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [camera.zoom, pushHistorySnapshot, unlockDocumentSelection, updateStickyWithoutHistory])

  const visibleDrawings = draftStroke
    ? [...activePage.drawings, draftStroke]
    : activePage.drawings
  const selectionBoxBounds = selectionBox ? getSelectionBounds(selectionBox) : null

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

          <svg className="absolute inset-0 h-full w-full overflow-visible">
            {visibleDrawings.map((stroke) => (
              <g key={stroke.id}>
                {selectedDrawingIdsSet.has(stroke.id) ? (
                  <polyline
                    fill="none"
                    stroke="#f3e600"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={(stroke.width + 6) * camera.zoom}
                    opacity={0.28}
                    pointerEvents="none"
                    points={stroke.points
                      .map(
                        (point) =>
                          `${(point.x - camera.x) * camera.zoom},${(point.y - camera.y) * camera.zoom}`,
                      )
                      .join(' ')}
                  />
                ) : null}
                <polyline
                  data-board-drawing="true"
                  fill="none"
                  stroke={stroke.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={stroke.width * camera.zoom}
                  onMouseDown={
                    draftStroke?.id === stroke.id
                      ? undefined
                      : (event) => handleDrawingMouseDown(event, stroke)
                  }
                  style={{
                    pointerEvents:
                      boardTool === 'pan' && draftStroke?.id !== stroke.id ? 'stroke' : 'none',
                    cursor:
                      boardTool === 'pan' && draftStroke?.id !== stroke.id
                        ? draggingDrawingId === stroke.id
                          ? 'grabbing'
                          : 'grab'
                        : 'default',
                  }}
                  points={stroke.points
                    .map(
                      (point) =>
                        `${(point.x - camera.x) * camera.zoom},${(point.y - camera.y) * camera.zoom}`,
                    )
                    .join(' ')}
                />
              </g>
            ))}
          </svg>

            {activePage.stickies.length || visibleDrawings.length ? (
              activePage.stickies.map((sticky) => {
                const linkedProfile = sticky.linkedProfileId
                  ? boardProfilesById.get(sticky.linkedProfileId)
                  : undefined
                const linkedProfileFieldData = sticky.linkedProfileId
                  ? boardProfileFieldData[sticky.linkedProfileId]
                  : undefined
                const hasHpMetric = linkedProfile
                  ? parseMetricValue(linkedProfile.hpCurrent) !== null &&
                    parseMetricValue(linkedProfile.hpMax) !== null
                  : false
                const hpPercent = linkedProfile
                  ? getMetricPercent(linkedProfile.hpCurrent, linkedProfile.hpMax)
                  : 0

                return (
                  <article
                    key={sticky.id}
                    data-board-item="true"
                    onMouseDown={(event) => handleStickyMouseDown(event, sticky.id)}
                    className={`absolute border p-2 shadow-[0_10px_24px_rgba(0,0,0,0.28)] ${
                      sticky.kind === 'text'
                        ? 'border-white/20 bg-black/60'
                        : sticky.kind === 'image'
                          ? 'border-white/20 bg-black/70'
                          : sticky.kind === 'sheet'
                            ? 'border-white/20 bg-black/78'
                            : STICKY_COLOR_CLASSES[sticky.color]
                    } ${
                      selectedItemIdsSet.has(sticky.id)
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

                      {sticky.kind !== 'image' && sticky.kind !== 'sheet' ? (
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

                    {sticky.kind === 'sheet' ? (
                      <div className="mt-2 space-y-3">
                        <div className="border border-white/12 bg-black/20 px-3 py-2.5">
                          <p className="truncate text-sm font-semibold text-white">
                            {sticky.title || linkedProfile?.displayName || 'Ficha ligada'}
                          </p>
                          <p className="mt-1 text-[0.62rem] uppercase tracking-[0.18em] text-stone-500">
                            {linkedProfile?.subtitle ?? 'Sem perfil ligado'}
                          </p>
                        </div>

                        {linkedProfile ? (
                          <>
                            <div className="border border-white/10 bg-black/24 px-3 py-2.5">
                              <div className="flex items-end justify-between gap-3">
                                <div>
                                  <p className="text-[0.62rem] uppercase tracking-[0.18em] text-stone-500">
                                    HP
                                  </p>
                                  <p className="mt-1 text-lg font-semibold text-white">
                                    {linkedProfile.hpCurrent || '--'}
                                    <span className="ml-1 text-sm text-stone-500">
                                      / {linkedProfile.hpMax || '--'}
                                    </span>
                                  </p>
                                </div>

                                <p className="text-[0.65rem] uppercase tracking-[0.14em] text-stone-500">
                                  {hasHpMetric ? `${hpPercent}%` : 'sem total'}
                                </p>
                              </div>

                              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/8">
                                <div
                                  className={`h-full rounded-full ${
                                    hpPercent <= 35 ? 'bg-rose-400' : 'bg-[#f3e600]'
                                  }`}
                                  style={{ width: `${hpPercent}%` }}
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="border border-white/10 bg-black/20 px-3 py-2">
                                <p className="text-[0.62rem] uppercase tracking-[0.16em] text-stone-500">
                                  PS
                                </p>
                                <p className="mt-1 font-semibold text-white">
                                  {linkedProfile.psCurrent || '--'} / {linkedProfile.psMax || '--'}
                                </p>
                              </div>
                              <div className="border border-white/10 bg-black/20 px-3 py-2">
                                <p className="text-[0.62rem] uppercase tracking-[0.16em] text-stone-500">
                                  PE
                                </p>
                                <p className="mt-1 font-semibold text-white">
                                  {linkedProfile.peCurrent || '--'} / {linkedProfile.peMax || '--'}
                                </p>
                              </div>
                              <div className="border border-white/10 bg-black/20 px-3 py-2">
                                <p className="text-[0.62rem] uppercase tracking-[0.16em] text-stone-500">
                                  Defesa
                                </p>
                                <p className="mt-1 font-semibold text-white">
                                  {linkedProfile.defense || '--'}
                                </p>
                              </div>
                              <div className="border border-white/10 bg-black/20 px-3 py-2">
                                <p className="text-[0.62rem] uppercase tracking-[0.16em] text-stone-500">
                                  Bloqueio
                                </p>
                                <p className="mt-1 font-semibold text-white">
                                  {linkedProfile.block || '--'}
                                </p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="border border-white/10 bg-black/20 px-3 py-2">
                                <p className="text-[0.62rem] uppercase tracking-[0.16em] text-stone-500">
                                  Karma
                                </p>
                                <p className="mt-1 font-semibold text-white">
                                  {linkedProfile.karma || '--'}
                                </p>
                              </div>
                              <div className="border border-white/10 bg-black/20 px-3 py-2">
                                <p className="text-[0.62rem] uppercase tracking-[0.16em] text-stone-500">
                                  Sync
                                </p>
                                <p className="mt-1 font-semibold text-white">
                                  {linkedProfile.updatedAt ? 'Ao vivo' : 'Snapshot'}
                                </p>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                setPreviewSheetStickyId(sticky.id)
                              }}
                              className="signal-button inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-xs"
                              data-variant="ghost"
                              disabled={!linkedProfileFieldData || !Object.keys(linkedProfileFieldData).length}
                            >
                              <Search size={12} />
                              Ver ficha
                            </button>
                          </>
                        ) : (
                          <div className="border border-dashed border-white/10 bg-black/18 px-3 py-4 text-xs leading-6 text-stone-500">
                            Esta ficha ainda nao tem dados sincronizados no quadro.
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
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
                                {selectedItemIds.length === 1 && selectedItemId === sticky.id ? (
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
                      </>
                    )}
                    {selectedItemIds.length === 1 &&
                    selectedItemId === sticky.id &&
                    sticky.kind !== 'image' &&
                    sticky.kind !== 'sheet' &&
                    canEdit ? (
                      <button
                        type="button"
                        onMouseDown={(e) => startStickyResize(e, sticky)}
                        className="absolute bottom-0 right-0 h-4 w-4 translate-x-1/2 translate-y-1/2 border border-[#f3e600] bg-black shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                        title="Redimensionar"
                      />
                    ) : null}
                  </article>
                )
              })
            ) : (
            <div className="absolute left-1/2 top-1/2 w-[420px] -translate-x-1/2 -translate-y-1/2 border border-white/10 bg-black/55 px-6 py-5 text-center shadow-[0_18px_38px_rgba(0,0,0,0.35)]">
              <p className="panel-title">Quadro vazio</p>
              <p className="mt-3 text-sm leading-7 text-stone-400">
                Cria stickies, caixas de texto, imagens e paginas para montar o espaco do Silver como quiseres.
              </p>
            </div>
          )}

          {selectionBoxBounds ? (
            <div
              className="pointer-events-none absolute border border-dashed border-[#f3e600]/75 bg-[#f3e600]/10"
              style={{
                left: `${(selectionBoxBounds.left - camera.x) * camera.zoom}px`,
                top: `${(selectionBoxBounds.top - camera.y) * camera.zoom}px`,
                width: `${selectionBoxBounds.width * camera.zoom}px`,
                height: `${selectionBoxBounds.height * camera.zoom}px`,
              }}
            />
          ) : null}
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
            <SilverMessageComposerPanel
              recipients={playerMessageRecipients}
              onSend={async (recipientId, title, body) => {
                await onSendPlayerMessage?.(recipientId, title, body)
              }}
              canEdit={canEdit}
              sending={sendingPlayerMessage}
              error={playerMessageError}
            />

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

            <button
              type="button"
              onClick={() => onQuickSave?.()}
              disabled={!canEdit || !canQuickSave || quickSaveBusy}
              className="signal-button inline-flex items-center gap-2 px-4 py-2 text-xs"
              data-variant="ghost"
            >
              <Save size={13} />
              {quickSaveBusy ? 'A guardar...' : 'Guardar'}
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

          {previewSheetSticky && previewSheetFieldData && Object.keys(previewSheetFieldData).length ? (
            <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/72 p-4">
              <div
                className="flex max-h-[calc(100%-32px)] w-[min(78vw,860px)] flex-col border border-white/10 bg-[#0b0b0b] shadow-[0_18px_48px_rgba(0,0,0,0.52)]"
                onMouseDown={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {previewSheetSticky.title || previewSheetProfile?.displayName || 'Ficha ligada'}
                    </p>
                    <p className="mt-1 text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                      {previewSheetProfile?.subtitle ?? 'Perfil'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        updateSticky(previewSheetSticky.id, (entry) => ({
                          ...entry,
                          sheetPage: Math.max(1, (entry.sheetPage ?? 1) - 1),
                        }))
                      }
                      className="signal-button px-2 py-1 text-[0.65rem]"
                      data-variant="ghost"
                      disabled={previewSheetPage <= 1}
                      title="Pagina anterior"
                    >
                      <ChevronLeft size={12} />
                    </button>

                    {[1, 2, 3, 4].map((page) => (
                      <button
                        key={page}
                        type="button"
                        onClick={() =>
                          updateSticky(previewSheetSticky.id, (entry) => ({
                            ...entry,
                            sheetPage: page,
                          }))
                        }
                        className="signal-button px-2.5 py-1 text-[0.65rem]"
                        data-variant={previewSheetPage === page ? undefined : 'ghost'}
                      >
                        {page}
                      </button>
                    ))}

                    <button
                      type="button"
                      onClick={() =>
                        updateSticky(previewSheetSticky.id, (entry) => ({
                          ...entry,
                          sheetPage: Math.min(4, (entry.sheetPage ?? 1) + 1),
                        }))
                      }
                      className="signal-button px-2 py-1 text-[0.65rem]"
                      data-variant="ghost"
                      disabled={previewSheetPage >= 4}
                      title="Pagina seguinte"
                    >
                      <ChevronRight size={12} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setPreviewSheetStickyId(null)}
                      className="signal-button px-3 py-1.5 text-[0.65rem]"
                      data-variant="ghost"
                    >
                      Fechar
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto bg-[#070707] p-4">
                  <PdfSheetPreview
                    fieldData={previewSheetFieldData}
                    pageNumber={previewSheetPage}
                    className="mx-auto w-full max-w-[760px] [&_input]:pointer-events-none [&_select]:pointer-events-none [&_textarea]:pointer-events-none"
                  />
                </div>
              </div>
            </div>
          ) : null}

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
