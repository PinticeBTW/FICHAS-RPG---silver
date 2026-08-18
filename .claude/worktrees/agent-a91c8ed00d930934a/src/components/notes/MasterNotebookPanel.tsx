import {
  BookOpenText,
  Folder,
  FolderPlus,
  LoaderCircle,
  Plus,
  Save,
  Search,
  Star,
  StarOff,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatTimestamp } from '../../lib/utils'
import {
  createMasterNote,
  createMasterNoteFolder,
  deleteMasterNote,
  getMasterNoteById,
  isMasterNotesUnavailableError,
  listMasterNoteFolders,
  listMasterNotes,
  listNoteRecipients,
  listShareablePlayers,
  setNoteVisibilityAndRecipients,
  updateMasterNote,
} from '../../lib/masterNotesService'
import {
  MASTER_NOTE_TYPES,
  type MasterNote,
  type MasterNoteListItem,
} from '../../types/masterNotes'
import type { Profile } from '../../types/domain'
import type {
  MasterNoteFolder,
  MasterNoteType,
  MasterNoteVisibility,
  ShareableMasterNotePlayer,
} from '../../types/masterNotes'

const MASTER_NOTE_DRAFT_STORAGE_PREFIX = 'rpgsilver-master-note-draft:'
const MASTER_NOTE_SELECTED_STORAGE_PREFIX = 'rpgsilver-master-note-selected:'
const MASTER_NOTE_SQL_HINT =
  'Ativa o SQL da feature no Supabase: corre supabase/master-notes-sharing.sql no SQL Editor.'
const NEW_NOTE_DEFAULT_TITLE = 'Sem titulo'
const AUTOSAVE_DEBOUNCE_MS = 1800

type FolderFilter = 'all' | 'unfiled' | `folder:${string}`
type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

type NoteEditorDraft = {
  title: string
  content: string
  noteType: MasterNoteType
  folderId: string | null
  tagsText: string
  visibility: MasterNoteVisibility
  isFavorite: boolean
  recipientUserIds: string[]
}

type PendingLocalDraft = {
  noteId: string
  draft: NoteEditorDraft
}

type PersistNoteSource = 'autosave' | 'manual' | 'switch'

type PersistNoteSnapshot = {
  noteId: string
  userId: string
  requestId: number
  draft: NoteEditorDraft
  baseDraft: NoteEditorDraft | null
  normalizedDraft: NormalizedNoteDraft
}

type QueuedPersistSnapshot = {
  snapshot: PersistNoteSnapshot
  source: PersistNoteSource
}

type NormalizedNoteDraft = {
  title: string
  content: string
  noteType: MasterNoteType
  folderId: string | null
  tags: string[]
  visibility: MasterNoteVisibility
  isFavorite: boolean
  recipientUserIds: string[]
}

type MasterNotebookPanelProps = {
  userId: string
  viewerProfile: Profile
  canEdit: boolean
}

function buildDraftStorageKey(userId: string, noteId: string) {
  return `${MASTER_NOTE_DRAFT_STORAGE_PREFIX}${userId}:${noteId}`
}

function buildSelectedNoteStorageKey(userId: string) {
  return `${MASTER_NOTE_SELECTED_STORAGE_PREFIX}${userId}`
}

function normalizeFolderId(value: string | null | undefined) {
  if (!value || !value.trim()) {
    return null
  }

  return value
}

function normalizeRecipientUserIds(value: string[]) {
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  )
}

function areRecipientIdsEqual(left: string[], right: string[]) {
  const normalizedLeft = normalizeRecipientUserIds(left)
  const normalizedRight = normalizeRecipientUserIds(right)

  if (normalizedLeft.length !== normalizedRight.length) {
    return false
  }

  return normalizedLeft.every((entry, index) => entry === normalizedRight[index])
}

function sanitizeTag(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeTagsText(tags: string[]) {
  return tags.join(', ')
}

function parseTagsText(tagsText: string) {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const rawTag of tagsText.split(',')) {
    const tag = sanitizeTag(rawTag)

    if (!tag) {
      continue
    }

    const lower = tag.toLowerCase()
    if (seen.has(lower)) {
      continue
    }

    seen.add(lower)
    normalized.push(tag)
  }

  return normalized
}

function toEditorDraft(note: MasterNote, recipientUserIds: string[]): NoteEditorDraft {
  return {
    title: note.title,
    content: note.content,
    noteType: note.noteType,
    folderId: normalizeFolderId(note.folderId),
    tagsText: normalizeTagsText(note.tags),
    visibility: note.visibility,
    isFavorite: note.isFavorite,
    recipientUserIds: normalizeRecipientUserIds(recipientUserIds),
  }
}

function cloneNoteEditorDraft(draft: NoteEditorDraft): NoteEditorDraft {
  return {
    ...draft,
    recipientUserIds: [...draft.recipientUserIds],
  }
}

function toListItem(note: MasterNote): MasterNoteListItem {
  return {
    id: note.id,
    userId: note.userId,
    title: note.title,
    noteType: note.noteType,
    folderId: normalizeFolderId(note.folderId),
    tags: note.tags,
    visibility: note.visibility,
    isFavorite: note.isFavorite,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
}

function normalizeNoteDraft(draft: NoteEditorDraft): NormalizedNoteDraft {
  return {
    title: typeof draft.title === 'string' ? draft.title : '',
    content: typeof draft.content === 'string' ? draft.content : '',
    noteType: MASTER_NOTE_TYPES.includes(draft.noteType) ? draft.noteType : 'note',
    folderId: normalizeFolderId(draft.folderId),
    tags: parseTagsText(draft.tagsText),
    visibility:
      draft.visibility === 'all_players' || draft.visibility === 'selected_players'
        ? draft.visibility
        : 'private',
    isFavorite: Boolean(draft.isFavorite),
    recipientUserIds:
      draft.visibility === 'selected_players' ? normalizeRecipientUserIds(draft.recipientUserIds) : [],
  }
}

function areNormalizedDraftsEqual(left: NormalizedNoteDraft, right: NormalizedNoteDraft) {
  if (
    left.title !== right.title ||
    left.content !== right.content ||
    left.noteType !== right.noteType ||
    left.folderId !== right.folderId ||
    left.visibility !== right.visibility ||
    left.isFavorite !== right.isFavorite
  ) {
    return false
  }

  if (left.tags.length !== right.tags.length) {
    return false
  }

  for (let index = 0; index < left.tags.length; index += 1) {
    if (left.tags[index] !== right.tags[index]) {
      return false
    }
  }

  return areRecipientIdsEqual(left.recipientUserIds, right.recipientUserIds)
}

function readLocalDraft(userId: string, noteId: string) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawDraft = window.localStorage.getItem(buildDraftStorageKey(userId, noteId))

    if (!rawDraft) {
      return null
    }

    const parsed = JSON.parse(rawDraft) as unknown

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const draft = parsed as Record<string, unknown>
    const rawVisibility = draft.visibility
    const visibility: MasterNoteVisibility =
      rawVisibility === 'all_players' || rawVisibility === 'selected_players'
        ? rawVisibility
        : 'private'

    return {
      title: typeof draft.title === 'string' ? draft.title : 'Sem titulo',
      content: typeof draft.content === 'string' ? draft.content : '',
      noteType: MASTER_NOTE_TYPES.includes(draft.noteType as MasterNoteType)
        ? (draft.noteType as MasterNoteType)
        : 'note',
      folderId: normalizeFolderId(typeof draft.folderId === 'string' ? draft.folderId : null),
      tagsText: typeof draft.tagsText === 'string' ? draft.tagsText : '',
      visibility,
      isFavorite: Boolean(draft.isFavorite),
      recipientUserIds: Array.isArray(draft.recipientUserIds)
        ? normalizeRecipientUserIds(
            draft.recipientUserIds.filter((entry): entry is string => typeof entry === 'string'),
          )
        : [],
    } satisfies NoteEditorDraft
  } catch {
    return null
  }
}

function saveLocalDraft(userId: string, noteId: string, draft: NoteEditorDraft) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(buildDraftStorageKey(userId, noteId), JSON.stringify(draft))
  } catch {
    return
  }
}

function clearLocalDraft(userId: string, noteId: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(buildDraftStorageKey(userId, noteId))
  } catch {
    return
  }
}

function readSelectedNoteId(userId: string) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage.getItem(buildSelectedNoteStorageKey(userId))
  } catch {
    return null
  }
}

function writeSelectedNoteId(userId: string, noteId: string | null) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const storageKey = buildSelectedNoteStorageKey(userId)

    if (!noteId) {
      window.localStorage.removeItem(storageKey)
      return
    }

    window.localStorage.setItem(storageKey, noteId)
  } catch {
    return
  }
}

function buildSaveErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'Erro ao guardar nota.'
}

function doesDraftMatchFolderFilter(draft: NoteEditorDraft, folderFilter: FolderFilter) {
  const folderId = normalizeFolderId(draft.folderId)

  if (folderFilter === 'all') {
    return true
  }

  if (folderFilter === 'unfiled') {
    return folderId === null
  }

  return folderId === normalizeFolderId(folderFilter.slice('folder:'.length))
}

function sortNotes(left: MasterNoteListItem, right: MasterNoteListItem) {
  if (left.isFavorite !== right.isFavorite) {
    return left.isFavorite ? -1 : 1
  }

  return right.updatedAt.localeCompare(left.updatedAt)
}

function dedupeNotesById(notes: MasterNoteListItem[]) {
  const next: MasterNoteListItem[] = []
  const indexById = new Map<string, number>()

  for (const note of notes) {
    const existingIndex = indexById.get(note.id)

    if (typeof existingIndex === 'number') {
      next[existingIndex] = note
      continue
    }

    indexById.set(note.id, next.length)
    next.push(note)
  }

  return next
}

function upsertNoteInList(notes: MasterNoteListItem[], note: MasterNoteListItem) {
  let found = false
  const next = notes.map((entry) => {
    if (entry.id !== note.id) {
      return entry
    }

    found = true
    return note
  })

  if (!found) {
    next.push(note)
  }

  return dedupeNotesById(next).sort(sortNotes)
}

function logMasterNotesDebug(event: string, payload: Record<string, unknown>) {
  if (!import.meta.env.DEV) {
    return
  }

  console.debug(`[MASTER_NOTES] ${event}`, payload)
}

export function MasterNotebookPanel({ userId, viewerProfile, canEdit }: MasterNotebookPanelProps) {
  const [visibleNotes, setVisibleNotes] = useState<MasterNoteListItem[]>([])
  const [allNotes, setAllNotes] = useState<MasterNoteListItem[]>([])
  const [folders, setFolders] = useState<MasterNoteFolder[]>([])
  const [shareablePlayers, setShareablePlayers] = useState<ShareableMasterNotePlayer[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [folderFilter, setFolderFilter] = useState<FolderFilter>('all')
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [selectedNote, setSelectedNote] = useState<MasterNote | null>(null)
  const [editorDraft, setEditorDraft] = useState<NoteEditorDraft | null>(null)
  const [baseEditorDraft, setBaseEditorDraft] = useState<NoteEditorDraft | null>(null)
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [loadingNoteDetail, setLoadingNoteDetail] = useState(false)
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [creatingNote, setCreatingNote] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [deletingNote, setDeletingNote] = useState(false)
  const [addingFolder, setAddingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [listError, setListError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pendingLocalDraft, setPendingLocalDraft] = useState<PendingLocalDraft | null>(null)
  const [userHasEdited, setUserHasEdited] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)

  const selectedNoteIdRef = useRef<string | null>(null)
  const editorDraftRef = useRef<NoteEditorDraft | null>(null)
  const baseEditorDraftRef = useRef<NoteEditorDraft | null>(null)
  const savedSnapshotRef = useRef<NormalizedNoteDraft | null>(null)
  const isHydratingRef = useRef(false)
  const saveInFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const notesFetchRequestRef = useRef(0)
  const previousFolderFilterRef = useRef<FolderFilter>('all')
  const createInFlightRef = useRef(false)
  const saveRequestIdRef = useRef(0)
  const lastLoadedNoteIdRef = useRef<string | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)
  const autosavePendingRef = useRef<PersistNoteSnapshot | null>(null)
  const queuedPersistRef = useRef<QueuedPersistSnapshot | null>(null)
  const persistNoteSnapshotRef = useRef<
    ((snapshot: PersistNoteSnapshot, source: PersistNoteSource) => Promise<void>) | null
  >(null)
  const userHasEditedRef = useRef(false)
  const draftRestoredRef = useRef(false)

  const allShareableRecipientUserIds = useMemo(
    () =>
      normalizeRecipientUserIds(
        shareablePlayers
          .filter((entry) => entry.canReceiveSharedNotes && entry.linkedUserId)
          .map((entry) => entry.linkedUserId as string),
      ),
    [shareablePlayers],
  )

  const linkedShareableRecipientUserIdSet = useMemo(
    () => new Set(allShareableRecipientUserIds),
    [allShareableRecipientUserIds],
  )

  const selectedFolderName = useMemo(() => {
    if (folderFilter === 'all') {
      return 'Todas'
    }

    if (folderFilter === 'unfiled') {
      return 'Sem pasta'
    }

    const folderId = folderFilter.slice('folder:'.length)
    const folder = folders.find((entry) => entry.id === folderId)
    return folder?.name ?? 'Pasta'
  }, [folderFilter, folders])

  const saveStatusLabel = useMemo(() => {
    if (saveStatus === 'saving') {
      return 'A guardar...'
    }

    if (saveStatus === 'error') {
      return 'Erro ao guardar - rascunho local seguro'
    }

    if (saveStatus === 'dirty') {
      return 'Alteracoes por guardar'
    }

    if (saveStatus === 'saved') {
      return 'Guardado agora'
    }

    return 'Guardado'

    if (saveStatus === 'dirty') {
      return 'Alterações por guardar'
    }

    if (saveStatus === 'saved') {
      return 'Guardado'
    }

    return 'Guardado'
  }, [saveStatus])

  const noteCountByFolderId = useMemo(() => {
    const counts = new Map<string, number>()
    let unfiledCount = 0

    for (const note of allNotes) {
      const folderId = normalizeFolderId(note.folderId)

      if (!folderId) {
        unfiledCount += 1
        continue
      }

      counts.set(folderId, (counts.get(folderId) ?? 0) + 1)
    }

    return {
      counts,
      unfiledCount,
    }
  }, [allNotes])

  const normalizedEditorDraft = useMemo(
    () => (editorDraft ? normalizeNoteDraft(editorDraft) : null),
    [editorDraft],
  )
  const normalizedSavedSnapshot = useMemo(
    () => (baseEditorDraft ? normalizeNoteDraft(baseEditorDraft) : null),
    [baseEditorDraft],
  )
  const hasUnsavedChanges = Boolean(
    selectedNoteId &&
      normalizedEditorDraft &&
      normalizedSavedSnapshot &&
      !areNormalizedDraftsEqual(normalizedEditorDraft, normalizedSavedSnapshot) &&
      (userHasEdited || draftRestored),
  )

  const selectedPlayersCount = editorDraft
    ? normalizeRecipientUserIds(
        editorDraft.recipientUserIds.filter((entry) => linkedShareableRecipientUserIdSet.has(entry)),
      ).length
    : 0

  const setEditorField = useCallback(
    <K extends keyof NoteEditorDraft>(key: K, value: NoteEditorDraft[K]) => {
      setEditorDraft((current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          [key]: value,
        }
      })
    },
    [],
  )

  const setEditorFieldFromUser = useCallback(
    <K extends keyof NoteEditorDraft>(key: K, value: NoteEditorDraft[K]) => {
      setEditorField(key, value)
      setUserHasEdited(true)
      setDraftRestored(false)
      setSaveError(null)
    },
    [setEditorField],
  )

  const confirmLeaveWithoutSaving = useCallback(() => {
    if (!hasUnsavedChanges) {
      return true
    }

    return window.confirm('Tens alterações por guardar nesta nota. Queres sair sem guardar?')
  }, [hasUnsavedChanges])
  void confirmLeaveWithoutSaving

  const refreshNoteLists = useCallback(async () => {
    const normalizedSearch = searchQuery.trim()
    const currentRequestId = notesFetchRequestRef.current + 1
    notesFetchRequestRef.current = currentRequestId

    setLoadingNotes(true)
    setListError(null)

    try {
      const [nextVisibleNotes, nextAllNotes] = await Promise.all([
        listMasterNotes({
          userId,
          searchQuery: normalizedSearch,
          folderFilter:
            folderFilter === 'all'
              ? 'all'
              : folderFilter === 'unfiled'
                ? 'unfiled'
                : folderFilter.slice('folder:'.length),
        }),
        listMasterNotes({
          userId,
          searchQuery: '',
          folderFilter: 'all',
          limit: 500,
        }),
      ])

      if (!mountedRef.current || notesFetchRequestRef.current !== currentRequestId) {
        return
      }

      setVisibleNotes(dedupeNotesById(nextVisibleNotes).sort(sortNotes))
      setAllNotes(dedupeNotesById(nextAllNotes).sort(sortNotes))
    } catch (error) {
      if (!mountedRef.current || notesFetchRequestRef.current !== currentRequestId) {
        return
      }

      const message = buildSaveErrorMessage(error)
      setListError(
        isMasterNotesUnavailableError(error)
          ? `${message} ${MASTER_NOTE_SQL_HINT}`
          : message,
      )
      setVisibleNotes([])
      setAllNotes([])
    } finally {
      if (mountedRef.current && notesFetchRequestRef.current === currentRequestId) {
        setLoadingNotes(false)
      }
    }
  }, [folderFilter, searchQuery, userId])

  const refreshFolders = useCallback(async () => {
    setLoadingFolders(true)

    try {
      const nextFolders = await listMasterNoteFolders(userId)

      if (!mountedRef.current) {
        return
      }

      setFolders(nextFolders)
    } catch (error) {
      if (!mountedRef.current) {
        return
      }

      const message = buildSaveErrorMessage(error)
      setListError(
        isMasterNotesUnavailableError(error)
          ? `${message} ${MASTER_NOTE_SQL_HINT}`
          : message,
      )
    } finally {
      if (mountedRef.current) {
        setLoadingFolders(false)
      }
    }
  }, [userId])

  const refreshShareablePlayers = useCallback(async () => {
    setLoadingPlayers(true)

    try {
      const nextPlayers = await listShareablePlayers(viewerProfile)

      if (!mountedRef.current) {
        return
      }

      setShareablePlayers(nextPlayers)
    } catch {
      if (!mountedRef.current) {
        return
      }

      setShareablePlayers([])
    } finally {
      if (mountedRef.current) {
        setLoadingPlayers(false)
      }
    }
  }, [viewerProfile])

  const buildPersistSnapshot = useCallback(
    (noteId: string, draft: NoteEditorDraft, baseDraft: NoteEditorDraft | null): PersistNoteSnapshot => ({
      noteId,
      userId,
      requestId: ++saveRequestIdRef.current,
      draft: cloneNoteEditorDraft(draft),
      baseDraft: baseDraft ? cloneNoteEditorDraft(baseDraft) : null,
      normalizedDraft: normalizeNoteDraft(draft),
    }),
    [userId],
  )

  const cancelAutosave = useCallback((noteId?: string) => {
    const pendingSnapshot = autosavePendingRef.current

    if (noteId && pendingSnapshot && pendingSnapshot.noteId !== noteId) {
      return
    }

    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }

    if (!noteId || pendingSnapshot?.noteId === noteId) {
      autosavePendingRef.current = null
    }
  }, [])

  const persistNoteSnapshot = useCallback(
    async (snapshot: PersistNoteSnapshot, source: PersistNoteSource) => {
      if (saveInFlightRef.current) {
        queuedPersistRef.current = { snapshot, source }
        return
      }

      saveInFlightRef.current = true
      const { noteId, requestId, draft, baseDraft, normalizedDraft } = snapshot
      const noteStillSelected = selectedNoteIdRef.current === noteId

      if (noteStillSelected) {
        setSaveStatus('saving')
        setSaveError(null)
      }

      if (source === 'autosave') {
        logMasterNotesDebug('autosave flush', { noteId, requestId })
      } else if (source === 'manual') {
        logMasterNotesDebug('save manual', { id: noteId, requestId })
      }

      try {
        let savedNote =
          noteStillSelected && selectedNote?.id === noteId ? selectedNote : await getMasterNoteById(userId, noteId)

        const normalizedCurrentRecipients = normalizeRecipientUserIds(
          draft.recipientUserIds.filter((entry) => linkedShareableRecipientUserIdSet.has(entry)),
        )
        const normalizedBaseRecipients = normalizeRecipientUserIds(baseDraft?.recipientUserIds ?? [])
        const shareSettingsChanged =
          !baseDraft ||
          draft.visibility !== baseDraft.visibility ||
          !areRecipientIdsEqual(normalizedCurrentRecipients, normalizedBaseRecipients)
        const noteFieldsChanged =
          !baseDraft ||
          draft.title !== baseDraft.title ||
          draft.content !== baseDraft.content ||
          draft.noteType !== baseDraft.noteType ||
          normalizeFolderId(draft.folderId) !== normalizeFolderId(baseDraft.folderId) ||
          draft.tagsText !== baseDraft.tagsText ||
          draft.isFavorite !== baseDraft.isFavorite

        if (noteFieldsChanged) {
          savedNote = await updateMasterNote(userId, noteId, {
            title: draft.title,
            content: draft.content,
            noteType: draft.noteType,
            folderId: normalizeFolderId(draft.folderId),
            tags: parseTagsText(draft.tagsText),
            isFavorite: draft.isFavorite,
          })
        }

        let recipientUserIdsForSave: string[] = normalizedCurrentRecipients

        if (shareSettingsChanged) {
          if (draft.visibility === 'private') {
            recipientUserIdsForSave = []
          } else if (draft.visibility === 'all_players') {
            recipientUserIdsForSave = allShareableRecipientUserIds
          }

          savedNote = await setNoteVisibilityAndRecipients(
            userId,
            noteId,
            draft.visibility,
            recipientUserIdsForSave,
          )
        }

        if (!mountedRef.current) {
          return
        }

        if (savedNote.id !== noteId) {
          logMasterNotesDebug('autosave stale ignored', { noteId, requestId })
          return
        }

        const savedDraft = toEditorDraft(savedNote, recipientUserIdsForSave)
        const savedListItem = toListItem(savedNote)
        const stillSelectedAfterSave = selectedNoteIdRef.current === noteId
        const matchesCurrentFolder = doesDraftMatchFolderFilter(savedDraft, folderFilter)

        if (matchesCurrentFolder) {
          setVisibleNotes((current) => upsertNoteInList(current, savedListItem))
        } else {
          setVisibleNotes((current) => current.filter((entry) => entry.id !== savedNote.id))
        }

        setAllNotes((current) => upsertNoteInList(current, savedListItem))

        const currentEditorDraft = editorDraftRef.current
        const currentNormalizedDraft = currentEditorDraft ? normalizeNoteDraft(currentEditorDraft) : null
        const hasNewerEditsSinceSnapshot = Boolean(
          stillSelectedAfterSave &&
            currentNormalizedDraft &&
            !areNormalizedDraftsEqual(currentNormalizedDraft, normalizedDraft) &&
            (userHasEditedRef.current || draftRestoredRef.current),
        )

        if (!stillSelectedAfterSave || !hasNewerEditsSinceSnapshot) {
          clearLocalDraft(userId, noteId)
          logMasterNotesDebug('local draft discarded', { id: noteId })
        }

        if (stillSelectedAfterSave) {
          setSelectedNote(savedNote)
          setBaseEditorDraft(savedDraft)
          savedSnapshotRef.current = normalizeNoteDraft(savedDraft)

          if (!hasNewerEditsSinceSnapshot) {
            setEditorDraft(savedDraft)
            setUserHasEdited(false)
            setDraftRestored(false)
            setPendingLocalDraft((current) => (current?.noteId === noteId ? null : current))
            setSaveStatus('saved')
            setSaveError(null)
          } else if (saveStatus !== 'saving') {
            setSaveStatus('dirty')
          }
        }

        if (source === 'autosave') {
          logMasterNotesDebug('autosave success', { noteId, requestId })
        }
      } catch (error) {
        if (!mountedRef.current) {
          return
        }

        if (source === 'autosave') {
          logMasterNotesDebug('autosave failed', { noteId, requestId })
        }

        if (selectedNoteIdRef.current !== noteId) {
          return
        }

        setSaveStatus('error')
        setSaveError(`${buildSaveErrorMessage(error)} - rascunho local seguro.`)
      } finally {
        saveInFlightRef.current = false
        const queued = queuedPersistRef.current
        queuedPersistRef.current = null

        if (queued) {
          void persistNoteSnapshotRef.current?.(queued.snapshot, queued.source)
        }
      }
    },
    [
      allShareableRecipientUserIds,
      folderFilter,
      linkedShareableRecipientUserIdSet,
      saveStatus,
      selectedNote,
      userId,
    ],
  )

  const flushAutosaveForNote = useCallback(
    async (noteId: string, source: PersistNoteSource) => {
      let snapshot: PersistNoteSnapshot | null = null
      const pendingSnapshot = autosavePendingRef.current

      if (pendingSnapshot && pendingSnapshot.noteId === noteId) {
        snapshot = pendingSnapshot
        autosavePendingRef.current = null

        if (autosaveTimerRef.current !== null) {
          window.clearTimeout(autosaveTimerRef.current)
          autosaveTimerRef.current = null
        }
      }

      if (!snapshot) {
        if (selectedNoteIdRef.current !== noteId) {
          return
        }

        const currentDraft = editorDraftRef.current
        if (!currentDraft || !(userHasEditedRef.current || draftRestoredRef.current)) {
          return
        }

        const normalizedCurrent = normalizeNoteDraft(currentDraft)
        const normalizedSnapshot = savedSnapshotRef.current

        if (!normalizedSnapshot || areNormalizedDraftsEqual(normalizedCurrent, normalizedSnapshot)) {
          return
        }

        snapshot = buildPersistSnapshot(noteId, currentDraft, baseEditorDraftRef.current)
      }

      await persistNoteSnapshot(snapshot, source)
    },
    [buildPersistSnapshot, persistNoteSnapshot],
  )

  const scheduleAutosave = useCallback((noteId: string, snapshot: PersistNoteSnapshot) => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
    }

    autosavePendingRef.current = snapshot
    autosaveTimerRef.current = window.setTimeout(() => {
      void flushAutosaveForNote(noteId, 'autosave')
    }, AUTOSAVE_DEBOUNCE_MS)

    logMasterNotesDebug('autosave scheduled', { noteId, requestId: snapshot.requestId })
  }, [flushAutosaveForNote])

  const handleSaveNote = useCallback(async () => {
    const noteId = selectedNoteIdRef.current

    if (!noteId) {
      return
    }

    if (!hasUnsavedChanges) {
      if (mountedRef.current && saveStatus !== 'error') {
        setSaveStatus('saved')
      }
      return
    }

    await flushAutosaveForNote(noteId, 'manual')
  }, [flushAutosaveForNote, hasUnsavedChanges, saveStatus])

  const clearCurrentEditorState = useCallback(() => {
    cancelAutosave()
    setSelectedNoteId(null)
    setSelectedNote(null)
    setEditorDraft(null)
    setBaseEditorDraft(null)
    setPendingLocalDraft(null)
    setUserHasEdited(false)
    setDraftRestored(false)
    setSaveStatus('idle')
    setSaveError(null)
    savedSnapshotRef.current = null
    isHydratingRef.current = false
    lastLoadedNoteIdRef.current = null
  }, [cancelAutosave])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      cancelAutosave()
      mountedRef.current = false
    }
  }, [cancelAutosave])

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId
  }, [selectedNoteId])

  useEffect(() => {
    editorDraftRef.current = editorDraft
  }, [editorDraft])

  useEffect(() => {
    baseEditorDraftRef.current = baseEditorDraft
  }, [baseEditorDraft])

  useEffect(() => {
    savedSnapshotRef.current = normalizedSavedSnapshot
  }, [normalizedSavedSnapshot])

  useEffect(() => {
    userHasEditedRef.current = userHasEdited
  }, [userHasEdited])

  useEffect(() => {
    draftRestoredRef.current = draftRestored
  }, [draftRestored])

  useEffect(() => {
    persistNoteSnapshotRef.current = persistNoteSnapshot
  }, [persistNoteSnapshot])

  useEffect(() => {
    cancelAutosave()
    queuedPersistRef.current = null
    const restoredSelectedNoteId = readSelectedNoteId(userId)
    setSelectedNoteId(restoredSelectedNoteId)
    setSelectedNote(null)
    setEditorDraft(null)
    setBaseEditorDraft(null)
    setPendingLocalDraft(null)
    setUserHasEdited(false)
    setDraftRestored(false)
    setSaveStatus('idle')
    setSaveError(null)
    savedSnapshotRef.current = null
    isHydratingRef.current = false
    lastLoadedNoteIdRef.current = null
  }, [cancelAutosave, userId])

  useEffect(() => {
    void refreshFolders()
    void refreshShareablePlayers()
  }, [refreshFolders, refreshShareablePlayers])

  useEffect(() => {
    if (previousFolderFilterRef.current === folderFilter) {
      return
    }

    previousFolderFilterRef.current = folderFilter
    clearCurrentEditorState()
    setVisibleNotes([])
  }, [clearCurrentEditorState, folderFilter])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshNoteLists()
    }, 240)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [refreshNoteLists])

  useEffect(() => {
    if (!visibleNotes.length) {
      clearCurrentEditorState()
      return
    }

    setSelectedNoteId((current) => {
      if (current && visibleNotes.some((entry) => entry.id === current)) {
        return current
      }

      const restored = readSelectedNoteId(userId)
      if (restored && visibleNotes.some((entry) => entry.id === restored)) {
        return restored
      }

      return visibleNotes[0].id
    })
  }, [clearCurrentEditorState, userId, visibleNotes])

  useEffect(() => {
    writeSelectedNoteId(userId, selectedNoteId)
  }, [selectedNoteId, userId])

  useEffect(() => {
    if (!selectedNoteId) {
      setSelectedNote(null)
      setEditorDraft(null)
      setBaseEditorDraft(null)
      setPendingLocalDraft(null)
      setUserHasEdited(false)
      setDraftRestored(false)
      setSaveStatus('idle')
      setSaveError(null)
      savedSnapshotRef.current = null
      isHydratingRef.current = false
      lastLoadedNoteIdRef.current = null
      return
    }

    if (!visibleNotes.some((entry) => entry.id === selectedNoteId)) {
      clearCurrentEditorState()
      return
    }

    let cancelled = false

    if (lastLoadedNoteIdRef.current !== selectedNoteId) {
      setSelectedNote(null)
      setEditorDraft(null)
      setBaseEditorDraft(null)
      setPendingLocalDraft(null)
      setUserHasEdited(false)
      setDraftRestored(false)
      savedSnapshotRef.current = null
      isHydratingRef.current = true
      lastLoadedNoteIdRef.current = selectedNoteId
    }

    setLoadingNoteDetail(true)
    setSaveError(null)

    void Promise.all([
      getMasterNoteById(userId, selectedNoteId),
      listNoteRecipients(userId, selectedNoteId),
    ])
      .then(([note, recipients]) => {
        if (cancelled || !mountedRef.current) {
          return
        }

        if (!visibleNotes.some((entry) => entry.id === selectedNoteId)) {
          return
        }

        const baseDraft = toEditorDraft(
          note,
          recipients.map((entry) => entry.recipientUserId),
        )
        const localDraft = readLocalDraft(userId, note.id)
        const normalizedBaseDraft = normalizeNoteDraft(baseDraft)
        const hasDifferentLocalDraft = localDraft
          ? !areNormalizedDraftsEqual(normalizeNoteDraft(localDraft), normalizedBaseDraft)
          : false

        setSelectedNote(note)
        setBaseEditorDraft(baseDraft)
        savedSnapshotRef.current = normalizedBaseDraft
        setUserHasEdited(false)
        setDraftRestored(false)
        setSaveStatus('saved')

        if (hasDifferentLocalDraft && localDraft) {
          setEditorDraft(baseDraft)
          setPendingLocalDraft({
            noteId: note.id,
            draft: localDraft,
          })
        } else {
          setEditorDraft(baseDraft)
          setPendingLocalDraft(null)

          if (localDraft) {
            clearLocalDraft(userId, note.id)
            logMasterNotesDebug('local draft discarded', { id: note.id })
          }
        }

        window.setTimeout(() => {
          if (mountedRef.current && selectedNoteIdRef.current === note.id) {
            isHydratingRef.current = false
          }
        }, 0)
      })
      .catch((error) => {
        if (cancelled || !mountedRef.current) {
          return
        }

        isHydratingRef.current = false

        const message = buildSaveErrorMessage(error)
        setListError(
          isMasterNotesUnavailableError(error)
            ? `${message} ${MASTER_NOTE_SQL_HINT}`
            : message,
        )
        clearCurrentEditorState()
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) {
          isHydratingRef.current = false
          setLoadingNoteDetail(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [clearCurrentEditorState, selectedNoteId, userId, visibleNotes])

  useEffect(() => {
    if (
      !selectedNoteId ||
      !editorDraft ||
      isHydratingRef.current ||
      !(userHasEdited || draftRestored) ||
      !hasUnsavedChanges
    ) {
      return
    }

    saveLocalDraft(userId, selectedNoteId, editorDraft)
    logMasterNotesDebug('local draft saved', { id: selectedNoteId })
  }, [draftRestored, editorDraft, hasUnsavedChanges, selectedNoteId, userHasEdited, userId])

  useEffect(() => {
    if (
      !canEdit ||
      !selectedNoteId ||
      !editorDraft ||
      isHydratingRef.current ||
      !(userHasEdited || draftRestored) ||
      !hasUnsavedChanges
    ) {
      cancelAutosave(selectedNoteId ?? undefined)
      return
    }

    const snapshot = buildPersistSnapshot(selectedNoteId, editorDraft, baseEditorDraftRef.current)
    scheduleAutosave(selectedNoteId, snapshot)
  }, [
    buildPersistSnapshot,
    canEdit,
    cancelAutosave,
    draftRestored,
    editorDraft,
    hasUnsavedChanges,
    scheduleAutosave,
    selectedNoteId,
    userHasEdited,
  ])

  useEffect(() => {
    if (!selectedNoteId || !editorDraft || !baseEditorDraft || isHydratingRef.current) {
      return
    }

    if (hasUnsavedChanges) {
      if (saveStatus !== 'saving' && saveStatus !== 'dirty') {
        setSaveStatus('dirty')
      }
      return
    }

    if (saveStatus !== 'saving' && saveStatus !== 'saved') {
      setSaveStatus('saved')
    }
  }, [baseEditorDraft, editorDraft, hasUnsavedChanges, saveStatus, selectedNoteId])

  useEffect(() => {
    if (!editorDraft) {
      return
    }

    if (editorDraft.visibility === 'all_players') {
      if (!areRecipientIdsEqual(editorDraft.recipientUserIds, allShareableRecipientUserIds)) {
        setEditorField('recipientUserIds', allShareableRecipientUserIds)
      }
      return
    }

    if (editorDraft.visibility === 'selected_players') {
      const filtered = normalizeRecipientUserIds(
        editorDraft.recipientUserIds.filter((entry) => linkedShareableRecipientUserIdSet.has(entry)),
      )

      if (!areRecipientIdsEqual(filtered, editorDraft.recipientUserIds)) {
        setEditorField('recipientUserIds', filtered)
      }
      return
    }

    if (editorDraft.recipientUserIds.length) {
      setEditorField('recipientUserIds', [])
    }
  }, [
    allShareableRecipientUserIds,
    editorDraft,
    linkedShareableRecipientUserIdSet,
    setEditorField,
  ])

  const createNote = useCallback(async () => {
    if (!canEdit) {
      return
    }

    const previousNoteId = selectedNoteIdRef.current
    if (previousNoteId) {
      void flushAutosaveForNote(previousNoteId, 'switch')
    }

    if (createInFlightRef.current) {
      return
    }

    createInFlightRef.current = true
    setCreatingNote(true)
    setListError(null)

    try {
      const folderId =
        folderFilter === 'all'
          ? null
          : folderFilter === 'unfiled'
            ? null
            : normalizeFolderId(folderFilter.slice('folder:'.length))
      const created = await createMasterNote({
        userId,
        title: NEW_NOTE_DEFAULT_TITLE,
        folderId,
      })

      if (!mountedRef.current) {
        return
      }

      setSearchQuery('')
      setSelectedNoteId(created.id)
      const createdDraft = toEditorDraft(created, [])
      setSelectedNote(created)
      setEditorDraft(createdDraft)
      setBaseEditorDraft(createdDraft)
      setPendingLocalDraft(null)
      setUserHasEdited(false)
      setDraftRestored(false)
      savedSnapshotRef.current = normalizeNoteDraft(createdDraft)
      isHydratingRef.current = false
      setSaveStatus('saved')
      setSaveError(null)
      await refreshNoteLists()
    } catch (error) {
      if (!mountedRef.current) {
        return
      }

      const message = buildSaveErrorMessage(error)
      setListError(
        isMasterNotesUnavailableError(error)
          ? `${message} ${MASTER_NOTE_SQL_HINT}`
          : message,
      )
    } finally {
      if (mountedRef.current) {
        setCreatingNote(false)
      }
      createInFlightRef.current = false
    }
  }, [canEdit, folderFilter, flushAutosaveForNote, refreshNoteLists, userId])

  const handleCreateFolder = useCallback(async () => {
    if (!canEdit) {
      return
    }

    const trimmedName = newFolderName.trim()

    if (!trimmedName) {
      return
    }

    setCreatingFolder(true)

    try {
      const createdFolder = await createMasterNoteFolder({
        userId,
        name: trimmedName,
      })

      if (!mountedRef.current) {
        return
      }

      setFolders((current) =>
        [...current, createdFolder].sort((left, right) => left.name.localeCompare(right.name)),
      )
      setNewFolderName('')
      setAddingFolder(false)
    } catch (error) {
      if (!mountedRef.current) {
        return
      }

      const message = buildSaveErrorMessage(error)
      setListError(
        isMasterNotesUnavailableError(error)
          ? `${message} ${MASTER_NOTE_SQL_HINT}`
          : message,
      )
    } finally {
      if (mountedRef.current) {
        setCreatingFolder(false)
      }
    }
  }, [canEdit, newFolderName, userId])

  const handleDeleteNote = useCallback(async () => {
    if (!canEdit || !selectedNote) {
      return
    }

    const confirmed = window.confirm(`Apagar "${selectedNote.title}"?`)
    if (!confirmed) {
      return
    }

    setDeletingNote(true)

    try {
      await deleteMasterNote(userId, selectedNote.id)

      if (!mountedRef.current) {
        return
      }

      clearLocalDraft(userId, selectedNote.id)
      logMasterNotesDebug('local draft discarded', { id: selectedNote.id })
      clearCurrentEditorState()
      await refreshNoteLists()
    } catch (error) {
      if (!mountedRef.current) {
        return
      }

      setListError(buildSaveErrorMessage(error))
    } finally {
      if (mountedRef.current) {
        setDeletingNote(false)
      }
    }
  }, [canEdit, clearCurrentEditorState, refreshNoteLists, selectedNote, userId])

  const toggleSelectedRecipient = useCallback(
    (recipientUserId: string) => {
      setUserHasEdited(true)
      setDraftRestored(false)
      setSaveError(null)
      setEditorDraft((current) => {
        if (!current || current.visibility !== 'selected_players') {
          return current
        }

        const nextRecipientUserIds = current.recipientUserIds.includes(recipientUserId)
          ? current.recipientUserIds.filter((entry) => entry !== recipientUserId)
          : [...current.recipientUserIds, recipientUserId]

        return {
          ...current,
          recipientUserIds: normalizeRecipientUserIds(nextRecipientUserIds),
        }
      })
    },
    [],
  )

  const handleSelectNote = useCallback(
    (noteId: string) => {
      if (noteId === selectedNoteId) {
        return
      }

      const previousNoteId = selectedNoteIdRef.current
      if (previousNoteId) {
        void flushAutosaveForNote(previousNoteId, 'switch')
      }

      setSelectedNoteId(noteId)
    },
    [flushAutosaveForNote, selectedNoteId],
  )

  const handleFolderFilterChange = useCallback(
    (nextFilter: FolderFilter) => {
      if (nextFilter === folderFilter) {
        return
      }

      const previousNoteId = selectedNoteIdRef.current
      if (previousNoteId) {
        void flushAutosaveForNote(previousNoteId, 'switch')
      }

      setFolderFilter(nextFilter)
    },
    [flushAutosaveForNote, folderFilter],
  )

  const handleRestorePendingLocalDraft = useCallback(() => {
    if (!pendingLocalDraft || pendingLocalDraft.noteId !== selectedNoteId) {
      return
    }

    setEditorDraft(pendingLocalDraft.draft)
    setPendingLocalDraft(null)
    setDraftRestored(true)
    setUserHasEdited(false)
    setSaveError(null)
    setSaveStatus('dirty')
    logMasterNotesDebug('local draft restored', { id: pendingLocalDraft.noteId })
  }, [pendingLocalDraft, selectedNoteId])

  const handleDiscardPendingLocalDraft = useCallback(() => {
    if (!pendingLocalDraft || pendingLocalDraft.noteId !== selectedNoteId) {
      return
    }

    clearLocalDraft(userId, pendingLocalDraft.noteId)
    setPendingLocalDraft(null)
    setDraftRestored(false)
    setUserHasEdited(false)
    setSaveError(null)
    if (saveStatus !== 'saving') {
      setSaveStatus('saved')
    }
    logMasterNotesDebug('local draft discarded', { id: pendingLocalDraft.noteId })
  }, [pendingLocalDraft, saveStatus, selectedNoteId, userId])

  const handleVisibilityChange = useCallback(
    (nextVisibility: MasterNoteVisibility) => {
      setUserHasEdited(true)
      setDraftRestored(false)
      setSaveError(null)
      setEditorDraft((current) => {
        if (!current) {
          return current
        }

        if (nextVisibility === 'private') {
          return {
            ...current,
            visibility: nextVisibility,
            recipientUserIds: [],
          }
        }

        if (nextVisibility === 'all_players') {
          return {
            ...current,
            visibility: nextVisibility,
            recipientUserIds: allShareableRecipientUserIds,
          }
        }

        return {
          ...current,
          visibility: nextVisibility,
          recipientUserIds: normalizeRecipientUserIds(
            current.recipientUserIds.filter((entry) => linkedShareableRecipientUserIdSet.has(entry)),
          ),
        }
      })
    },
    [allShareableRecipientUserIds, linkedShareableRecipientUserIdSet],
  )

  return (
    <section className="hud-panel rounded-[28px] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="min-w-0">
          <p className="panel-title">Caderno do Mestre</p>
          <p className="mt-2 text-sm text-stone-300">
            {selectedFolderName} | {visibleNotes.length} nota(s)
          </p>
        </div>

        <div className="text-right">
          <div className="mb-2">
            <button
              type="button"
              onClick={() => void handleSaveNote()}
              disabled={!canEdit || !selectedNoteId || !hasUnsavedChanges || saveStatus === 'saving'}
              className="signal-button inline-flex items-center gap-2 px-3 py-1.5 text-xs"
              data-variant="ghost"
              title="Guardar nota no Supabase"
            >
              <Save size={12} />
              Guardar Nota
            </button>
          </div>

          <p
            className={`text-xs uppercase tracking-[0.18em] ${
              saveStatus === 'error'
                ? 'text-rose-300'
                : saveStatus === 'saving' || saveStatus === 'dirty'
                  ? 'text-amber-200'
                  : 'text-stone-400'
            }`}
          >
            {saveStatusLabel}
          </p>
          {saveStatus === 'error' && saveError ? (
            <p className="mt-1 text-xs text-rose-300">{saveError}</p>
          ) : null}
        </div>
      </div>

      {listError ? (
        <div className="mt-3 border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {listError}
        </div>
      ) : null}

      {pendingLocalDraft && pendingLocalDraft.noteId === selectedNoteId ? (
        <div className="mt-3 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          <p>Existe um rascunho local por guardar para esta nota.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRestorePendingLocalDraft}
              className="signal-button px-3 py-1 text-xs"
            >
              Restaurar rascunho
            </button>
            <button
              type="button"
              onClick={handleDiscardPendingLocalDraft}
              className="signal-button px-3 py-1 text-xs"
              data-variant="ghost"
            >
              Descartar rascunho local
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_290px]">
        <aside className="space-y-3">
          <button
            type="button"
            onClick={() => void createNote()}
            disabled={!canEdit || creatingNote}
            className="signal-button inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-xs"
          >
            {creatingNote ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={13} />}
            + Nova Nota
          </button>

          {addingFolder ? (
            <div className="space-y-2 border border-white/10 bg-black/20 p-2">
              <input
                type="text"
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleCreateFolder()
                  }
                  if (event.key === 'Escape') {
                    setAddingFolder(false)
                    setNewFolderName('')
                  }
                }}
                placeholder="Nome da pasta"
                className="w-full border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-[#f3e600]/45"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleCreateFolder()}
                  disabled={creatingFolder}
                  className="signal-button inline-flex flex-1 items-center justify-center gap-2 px-3 py-1.5 text-xs"
                >
                  {creatingFolder ? <LoaderCircle size={12} className="animate-spin" /> : <Plus size={12} />}
                  Criar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingFolder(false)
                    setNewFolderName('')
                  }}
                  className="signal-button px-3 py-1.5 text-xs"
                  data-variant="ghost"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingFolder(true)}
              disabled={!canEdit}
              className="signal-button inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-xs"
              data-variant="ghost"
            >
              <FolderPlus size={13} />
              + Nova Pasta
            </button>
          )}

          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Pesquisar notas"
              className="w-full border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-[#f3e600]/45"
            />
          </div>

          <div className="border border-white/10 bg-black/20 p-2">
            <p className="px-1 text-[0.62rem] uppercase tracking-[0.2em] text-stone-500">Pastas</p>

            <div className="mt-2 space-y-1">
              <button
                type="button"
                onClick={() => handleFolderFilterChange('all')}
                className={`flex w-full items-center justify-between border px-2 py-1.5 text-left text-xs transition ${
                  folderFilter === 'all'
                    ? 'border-[#f3e600]/55 bg-[#f3e600]/10 text-white'
                    : 'border-white/10 bg-black/25 text-stone-300 hover:border-white/20'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <BookOpenText size={12} />
                  Todas
                </span>
                <span className="text-[0.65rem] text-stone-500">{allNotes.length}</span>
              </button>

              <button
                type="button"
                onClick={() => handleFolderFilterChange('unfiled')}
                className={`flex w-full items-center justify-between border px-2 py-1.5 text-left text-xs transition ${
                  folderFilter === 'unfiled'
                    ? 'border-[#f3e600]/55 bg-[#f3e600]/10 text-white'
                    : 'border-white/10 bg-black/25 text-stone-300 hover:border-white/20'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Folder size={12} />
                  Sem pasta
                </span>
                <span className="text-[0.65rem] text-stone-500">{noteCountByFolderId.unfiledCount}</span>
              </button>

              {loadingFolders ? (
                <p className="px-2 py-2 text-[0.68rem] text-stone-500">A carregar pastas...</p>
              ) : folders.length ? (
                folders.map((folder) => {
                  const value = `folder:${folder.id}` as const

                  return (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => handleFolderFilterChange(value)}
                      className={`flex w-full items-center justify-between border px-2 py-1.5 text-left text-xs transition ${
                        folderFilter === value
                          ? 'border-[#f3e600]/55 bg-[#f3e600]/10 text-white'
                          : 'border-white/10 bg-black/25 text-stone-300 hover:border-white/20'
                      }`}
                    >
                      <span className="truncate">{folder.name}</span>
                      <span className="text-[0.65rem] text-stone-500">
                        {noteCountByFolderId.counts.get(folder.id) ?? 0}
                      </span>
                    </button>
                  )
                })
              ) : (
                <p className="px-2 py-2 text-[0.68rem] text-stone-500">Sem pastas no caderno.</p>
              )}
            </div>
          </div>

          <div className="border border-white/10 bg-black/20 p-2">
            <p className="px-1 text-[0.62rem] uppercase tracking-[0.2em] text-stone-500">Recentes</p>

            <div className="mt-2 max-h-[360px] space-y-1 overflow-y-auto pr-1">
              {loadingNotes ? (
                <p className="px-2 py-2 text-[0.68rem] text-stone-500">A carregar notas...</p>
              ) : visibleNotes.length ? (
                visibleNotes.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => handleSelectNote(note.id)}
                    className={`w-full border px-2 py-2 text-left transition ${
                      note.id === selectedNoteId
                        ? 'border-[#f3e600]/55 bg-[#f3e600]/10'
                        : 'border-white/10 bg-black/25 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-xs font-semibold text-white">{note.title}</p>
                      {note.isFavorite ? (
                        <Star size={11} className="shrink-0 text-[#f3e600]" />
                      ) : (
                        <span className="shrink-0 text-[0.62rem] uppercase tracking-[0.18em] text-stone-600">
                          {note.noteType}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[0.66rem] text-stone-500">{formatTimestamp(note.updatedAt)}</p>
                  </button>
                ))
              ) : (
                <p className="px-2 py-2 text-[0.68rem] text-stone-500">
                  Pasta vazia ou sem notas para esta pesquisa.
                </p>
              )}
            </div>
          </div>
        </aside>

        <div className="min-w-0 border border-white/10 bg-black/20 p-3">
          {loadingNoteDetail ? (
            <div className="flex h-[420px] items-center justify-center text-sm text-stone-500">
              A carregar nota...
            </div>
          ) : !selectedNote || !editorDraft ? (
            <div className="flex h-[420px] items-center justify-center text-sm text-stone-500">
              Escolhe uma nota para editar.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editorDraft.title}
                  onChange={(event) => setEditorFieldFromUser('title', event.target.value)}
                  readOnly={!canEdit}
                  placeholder="Sem titulo"
                  className="min-w-0 flex-1 border border-white/10 bg-black/35 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-[#f3e600]/45"
                />

                <button
                  type="button"
                  onClick={() => setEditorFieldFromUser('isFavorite', !editorDraft.isFavorite)}
                  disabled={!canEdit}
                  className="signal-button inline-flex items-center gap-2 px-3 py-2 text-xs"
                  data-variant={editorDraft.isFavorite ? undefined : 'ghost'}
                  title={editorDraft.isFavorite ? 'Remover favorito' : 'Marcar favorito'}
                >
                  {editorDraft.isFavorite ? <StarOff size={13} /> : <Star size={13} />}
                </button>

                <button
                  type="button"
                  onClick={() => void handleDeleteNote()}
                  disabled={!canEdit || deletingNote}
                  className="signal-button inline-flex items-center gap-2 px-3 py-2 text-xs"
                  data-tone="danger"
                >
                  {deletingNote ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>

              <textarea
                value={editorDraft.content}
                onChange={(event) => setEditorFieldFromUser('content', event.target.value)}
                readOnly={!canEdit}
                placeholder="Escreve aqui lore, sessoes, segredos, NPC notes, locais e pistas..."
                className="min-h-[460px] w-full resize-y border border-white/10 bg-black/35 px-4 py-3 font-mono text-sm leading-7 text-stone-100 outline-none focus:border-[#f3e600]/45"
              />
            </div>
          )}
        </div>

        <aside className="space-y-3 border border-white/10 bg-black/20 p-3">
          <p className="panel-title">Meta</p>

          {selectedNote && editorDraft ? (
            <>
              <label className="block space-y-1">
                <span className="text-[0.62rem] uppercase tracking-[0.2em] text-stone-500">Tipo</span>
                <select
                  value={editorDraft.noteType}
                  onChange={(event) =>
                    setEditorFieldFromUser('noteType', event.target.value as MasterNoteType)
                  }
                  disabled={!canEdit}
                  className="w-full border border-white/10 bg-black/35 px-3 py-2 text-xs text-white outline-none focus:border-[#f3e600]/45"
                >
                  {MASTER_NOTE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[0.62rem] uppercase tracking-[0.2em] text-stone-500">Pasta</span>
                <select
                  value={editorDraft.folderId ?? ''}
                  onChange={(event) =>
                    setEditorFieldFromUser('folderId', normalizeFolderId(event.target.value || null))
                  }
                  disabled={!canEdit}
                  className="w-full border border-white/10 bg-black/35 px-3 py-2 text-xs text-white outline-none focus:border-[#f3e600]/45"
                >
                  <option value="">Sem pasta</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[0.62rem] uppercase tracking-[0.2em] text-stone-500">Tags</span>
                <input
                  type="text"
                  value={editorDraft.tagsText}
                  onChange={(event) => setEditorFieldFromUser('tagsText', event.target.value)}
                  readOnly={!canEdit}
                  placeholder="lore, pista, sessao"
                  className="w-full border border-white/10 bg-black/35 px-3 py-2 text-xs text-white outline-none focus:border-[#f3e600]/45"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[0.62rem] uppercase tracking-[0.2em] text-stone-500">Visibilidade</span>
                <select
                  value={editorDraft.visibility}
                  onChange={(event) => handleVisibilityChange(event.target.value as MasterNoteVisibility)}
                  disabled={!canEdit}
                  className="w-full border border-white/10 bg-black/35 px-3 py-2 text-xs text-white outline-none focus:border-[#f3e600]/45"
                >
                  <option value="private">Privado</option>
                  <option value="all_players">Todos os players</option>
                  <option value="selected_players">Players escolhidos</option>
                </select>
              </label>

              {editorDraft.visibility === 'private' ? (
                <div className="border border-white/10 bg-black/30 px-3 py-2 text-xs text-stone-300">
                  So o Mestre consegue ler esta nota.
                </div>
              ) : editorDraft.visibility === 'all_players' ? (
                <div className="border border-white/10 bg-black/30 px-3 py-2 text-xs text-stone-300">
                  Todos os players com conta ligada conseguem ler esta nota.
                </div>
              ) : (
                <div className="space-y-2 border border-white/10 bg-black/30 px-3 py-2">
                  <p className="text-[0.62rem] uppercase tracking-[0.18em] text-stone-400">
                    {selectedPlayersCount} player(s) selecionado(s)
                  </p>

                  {loadingPlayers ? (
                    <p className="text-xs text-stone-500">A carregar players...</p>
                  ) : shareablePlayers.length ? (
                    <div className="max-h-[220px] space-y-1 overflow-y-auto pr-1">
                      {shareablePlayers.map((player) => {
                        const recipientUserId = player.linkedUserId
                        const selected = recipientUserId
                          ? editorDraft.recipientUserIds.includes(recipientUserId)
                          : false

                        return (
                          <label
                            key={player.profileId}
                            className={`flex items-start gap-2 border px-2 py-1.5 text-xs ${
                              selected
                                ? 'border-[#f3e600]/55 bg-[#f3e600]/10 text-white'
                                : 'border-white/10 bg-black/20 text-stone-300'
                            } ${player.canReceiveSharedNotes ? 'cursor-pointer' : 'opacity-60'}`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={!canEdit || !player.canReceiveSharedNotes || !recipientUserId}
                              onChange={() => recipientUserId && toggleSelectedRecipient(recipientUserId)}
                              className="mt-0.5 h-3.5 w-3.5 accent-[#f3e600]"
                            />
                            <div className="min-w-0">
                              <p className="truncate font-semibold">{player.displayName}</p>
                              <p className="truncate text-[0.68rem] text-stone-500">
                                {player.email || player.handle}
                              </p>
                              {!player.canReceiveSharedNotes ? (
                                <p className="mt-0.5 text-[0.68rem] text-amber-300">
                                  sem conta ligada
                                </p>
                              ) : null}
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="border border-white/10 bg-black/20 px-2 py-2 text-xs text-stone-500">
                      Sem players disponiveis para partilha.
                    </div>
                  )}
                </div>
              )}

              <div className="border border-white/10 bg-black/30 px-3 py-2">
                <p className="text-[0.62rem] uppercase tracking-[0.2em] text-stone-500">Ultima edicao</p>
                <p className="mt-1 text-xs text-stone-300">{formatTimestamp(selectedNote.updatedAt)}</p>
              </div>
            </>
          ) : (
            <div className="border border-white/10 bg-black/30 px-3 py-3 text-xs text-stone-500">
              <div className="flex items-center gap-2">
                <UserRound size={13} />
                Sem nota selecionada.
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
