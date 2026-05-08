import { SUPABASE_CONFIG_ERROR, supabase } from './supabase'
import { clearSupabaseFetchCache, runSupabaseFetch } from './supabaseQueries'
import { isNpcProfile, listSheetProfiles } from './webSheetService'
import type { Profile } from '../types/domain'
import type {
  MasterNote,
  MasterNoteFolder,
  MasterNoteListItem,
  MasterNoteRecipient,
  MasterNoteType,
  MasterNoteVisibility,
  ShareableMasterNotePlayer,
} from '../types/masterNotes'

const MASTER_NOTES_CACHE_PREFIX = 'master-notes'
const MASTER_NOTE_FOLDERS_CACHE_PREFIX = 'master-note-folders'
const MASTER_NOTE_RECIPIENTS_CACHE_PREFIX = 'master-note-recipients'
const SHARED_MASTER_NOTES_CACHE_PREFIX = 'shared-master-notes'

type MasterNoteRow = {
  id: string
  user_id?: string | null
  title: string | null
  content?: string | null
  note_type: string | null
  folder_id: string | null
  tags: unknown
  visibility: string | null
  is_favorite: boolean | null
  created_at: string | null
  updated_at: string | null
}

type MasterNoteFolderRow = {
  id: string
  user_id: string
  name: string | null
  parent_id: string | null
  created_at: string | null
  updated_at: string | null
}

type MasterNoteRecipientRow = {
  id: string
  note_id: string
  owner_user_id: string
  recipient_user_id: string
  created_at: string | null
}

type MasterNoteFolderFilter = 'all' | 'unfiled' | string

type ListMasterNotesInput = {
  userId: string
  searchQuery?: string
  folderFilter?: MasterNoteFolderFilter
  limit?: number
}

type UpdateMasterNoteInput = {
  title?: string
  content?: string
  noteType?: MasterNoteType
  folderId?: string | null
  tags?: string[]
  isFavorite?: boolean
}

type CreateMasterNoteInput = {
  userId: string
  title?: string
  folderId?: string | null
}

type CreateMasterNoteFolderInput = {
  userId: string
  name: string
  parentId?: string | null
}

const NOTE_TYPE_FALLBACK: MasterNoteType = 'note'
const NOTE_VISIBILITY_FALLBACK: MasterNoteVisibility = 'private'
const MASTER_NOTE_TYPES: MasterNoteType[] = [
  'note',
  'session',
  'npc',
  'location',
  'quest',
  'secret',
  'rule',
]
const MASTER_NOTE_VISIBILITIES: MasterNoteVisibility[] = [
  'private',
  'all_players',
  'selected_players',
]

function ensureSupabase() {
  if (!supabase) {
    throw new Error(SUPABASE_CONFIG_ERROR)
  }

  return supabase
}

function ensureUserId(userId: string) {
  const normalizedUserId = userId.trim()

  if (!normalizedUserId) {
    throw new Error('Utilizador autenticado invalido para notas do mestre.')
  }

  return normalizedUserId
}

function normalizeText(value: string | null | undefined, fallback = '') {
  if (!value) {
    return fallback
  }

  return value
}

function normalizeFolderId(value: string | null | undefined) {
  if (!value || !value.trim()) {
    return null
  }

  return value
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
}

function normalizeNoteType(value: string | null | undefined): MasterNoteType {
  if (!value) {
    return NOTE_TYPE_FALLBACK
  }

  return MASTER_NOTE_TYPES.includes(value as MasterNoteType)
    ? (value as MasterNoteType)
    : NOTE_TYPE_FALLBACK
}

function normalizeVisibility(value: string | null | undefined): MasterNoteVisibility {
  if (!value) {
    return NOTE_VISIBILITY_FALLBACK
  }

  return MASTER_NOTE_VISIBILITIES.includes(value as MasterNoteVisibility)
    ? (value as MasterNoteVisibility)
    : NOTE_VISIBILITY_FALLBACK
}

function mapMasterNoteListItem(row: MasterNoteRow, fallbackUserId = ''): MasterNoteListItem {
  const nowIso = new Date().toISOString()

  return {
    id: row.id,
    userId: row.user_id ?? fallbackUserId,
    title: normalizeText(row.title, 'Sem titulo'),
    noteType: normalizeNoteType(row.note_type),
    folderId: normalizeFolderId(row.folder_id),
    tags: normalizeTags(row.tags),
    visibility: normalizeVisibility(row.visibility),
    isFavorite: Boolean(row.is_favorite),
    createdAt: row.created_at ?? nowIso,
    updatedAt: row.updated_at ?? nowIso,
  }
}

function mapMasterNote(row: MasterNoteRow, fallbackUserId = ''): MasterNote {
  const base = mapMasterNoteListItem(row, fallbackUserId)

  return {
    ...base,
    content: normalizeText(row.content),
  }
}

function dedupeMasterNoteListItems(notes: MasterNoteListItem[]) {
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

function mapMasterNoteFolder(row: MasterNoteFolderRow): MasterNoteFolder {
  const nowIso = new Date().toISOString()

  return {
    id: row.id,
    userId: row.user_id,
    name: normalizeText(row.name, 'Sem nome'),
    parentId: normalizeFolderId(row.parent_id),
    createdAt: row.created_at ?? nowIso,
    updatedAt: row.updated_at ?? nowIso,
  }
}

function mapMasterNoteRecipient(row: MasterNoteRecipientRow): MasterNoteRecipient {
  return {
    id: row.id,
    noteId: row.note_id,
    ownerUserId: row.owner_user_id,
    recipientUserId: row.recipient_user_id,
    createdAt: row.created_at ?? new Date().toISOString(),
  }
}

function sanitizeSearchQuery(value: string) {
  return value
    .replace(/[^0-9A-Za-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeForSaveTags(value: string[]) {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const entry of value) {
    const trimmed = entry.trim()

    if (!trimmed) {
      continue
    }

    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    normalized.push(trimmed)
  }

  return normalized
}

function normalizeRecipientUserIds(value: string[], ownerUserId: string) {
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))]
    .filter((entry) => entry !== ownerUserId)
}

function toErrorText(error: unknown) {
  if (!error || typeof error !== 'object') {
    return ''
  }

  const candidate = error as {
    code?: string
    message?: string
    details?: string
    hint?: string
  }

  return [
    candidate.code,
    candidate.message,
    candidate.details,
    candidate.hint,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function isMasterNotesUnavailableError(error: unknown) {
  const text = toErrorText(error)

  return (
    text.includes('rpg_master_notes') ||
    text.includes('rpg_master_note_folders') ||
    text.includes('rpg_master_note_recipients') ||
    text.includes('42p01') ||
    text.includes('42704') ||
    text.includes('pgrst205')
  )
}

export async function listMasterNotes({
  userId,
  searchQuery,
  folderFilter = 'all',
  limit = 250,
}: ListMasterNotesInput): Promise<MasterNoteListItem[]> {
  const client = ensureSupabase()
  const normalizedUserId = ensureUserId(userId)
  const normalizedSearch = searchQuery ? sanitizeSearchQuery(searchQuery) : ''
  const cacheKey = [
    MASTER_NOTES_CACHE_PREFIX,
    normalizedUserId,
    folderFilter,
    normalizedSearch || '__none__',
    limit,
  ].join(':')

  return runSupabaseFetch(
    cacheKey,
    { functionName: 'listMasterNotes', table: 'rpg_master_notes' },
    async () => {
      let queryBuilder = client
        .from('rpg_master_notes')
        .select('id, title, note_type, folder_id, tags, visibility, is_favorite, created_at, updated_at')
        .eq('user_id', normalizedUserId)

      if (folderFilter === 'unfiled') {
        queryBuilder = queryBuilder.is('folder_id', null)
      } else if (folderFilter !== 'all') {
        queryBuilder = queryBuilder.eq('folder_id', folderFilter)
      }

      if (normalizedSearch) {
        const like = `%${normalizedSearch}%`
        queryBuilder = queryBuilder.or(`title.ilike.${like},content.ilike.${like}`)
      }

      const { data, error } = await queryBuilder
        .order('is_favorite', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(limit)

      if (error) {
        throw error
      }

      return dedupeMasterNoteListItems(
        ((data ?? []) as MasterNoteRow[]).map((row) => mapMasterNoteListItem(row, normalizedUserId)),
      )
    },
    { cacheMs: normalizedSearch ? 0 : 2_500 },
  )
}

export async function getMasterNoteById(userId: string, noteId: string): Promise<MasterNote> {
  const client = ensureSupabase()
  const normalizedUserId = ensureUserId(userId)
  const cacheKey = `${MASTER_NOTES_CACHE_PREFIX}:detail:${normalizedUserId}:${noteId}`

  return runSupabaseFetch(
    cacheKey,
    { functionName: 'getMasterNoteById', table: 'rpg_master_notes' },
    async () => {
      const { data, error } = await client
        .from('rpg_master_notes')
        .select('id, user_id, title, content, note_type, folder_id, tags, visibility, is_favorite, created_at, updated_at')
        .eq('id', noteId)
        .eq('user_id', normalizedUserId)
        .single()

      if (error) {
        throw error
      }

      return mapMasterNote(data as MasterNoteRow, normalizedUserId)
    },
    { cacheMs: 1_500 },
  )
}

export async function createMasterNote({
  userId,
  title = 'Sem titulo',
  folderId = null,
}: CreateMasterNoteInput): Promise<MasterNote> {
  const client = ensureSupabase()
  const normalizedUserId = ensureUserId(userId)
  const normalizedFolderId = normalizeFolderId(folderId)
  const { data, error } = await client
    .from('rpg_master_notes')
    .insert({
      user_id: normalizedUserId,
      title: title.trim() || 'Sem titulo',
      content: '',
      note_type: NOTE_TYPE_FALLBACK,
      folder_id: normalizedFolderId,
      tags: [],
      visibility: NOTE_VISIBILITY_FALLBACK,
      is_favorite: false,
    })
    .select('id, user_id, title, content, note_type, folder_id, tags, visibility, is_favorite, created_at, updated_at')
    .single()

  if (error) {
    throw error
  }

  clearSupabaseFetchCache(`${MASTER_NOTES_CACHE_PREFIX}:${normalizedUserId}:`)
  clearSupabaseFetchCache(`${MASTER_NOTE_FOLDERS_CACHE_PREFIX}:${normalizedUserId}`)
  clearSupabaseFetchCache(`${SHARED_MASTER_NOTES_CACHE_PREFIX}:${normalizedUserId}`)
  return mapMasterNote(data as MasterNoteRow, normalizedUserId)
}

export async function updateMasterNote(
  userId: string,
  noteId: string,
  patch: UpdateMasterNoteInput,
): Promise<MasterNote> {
  const client = ensureSupabase()
  const normalizedUserId = ensureUserId(userId)
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (typeof patch.title !== 'undefined') {
    payload.title = patch.title.trim() || 'Sem titulo'
  }
  if (typeof patch.content !== 'undefined') {
    payload.content = patch.content
  }
  if (typeof patch.noteType !== 'undefined') {
    payload.note_type = patch.noteType
  }
  if (typeof patch.folderId !== 'undefined') {
    payload.folder_id = normalizeFolderId(patch.folderId)
  }
  if (typeof patch.isFavorite !== 'undefined') {
    payload.is_favorite = patch.isFavorite
  }
  if (typeof patch.tags !== 'undefined') {
    payload.tags = normalizeForSaveTags(patch.tags)
  }

  const { data, error } = await client
    .from('rpg_master_notes')
    .update(payload)
    .eq('id', noteId)
    .eq('user_id', normalizedUserId)
    .select('id, user_id, title, content, note_type, folder_id, tags, visibility, is_favorite, created_at, updated_at')
    .single()

  if (error) {
    throw error
  }

  clearSupabaseFetchCache(`${MASTER_NOTES_CACHE_PREFIX}:${normalizedUserId}:`)
  clearSupabaseFetchCache(`${MASTER_NOTES_CACHE_PREFIX}:detail:${normalizedUserId}:${noteId}`)
  clearSupabaseFetchCache(`${SHARED_MASTER_NOTES_CACHE_PREFIX}:${normalizedUserId}`)
  return mapMasterNote(data as MasterNoteRow, normalizedUserId)
}

export async function deleteMasterNote(userId: string, noteId: string): Promise<void> {
  const client = ensureSupabase()
  const normalizedUserId = ensureUserId(userId)
  const { error } = await client
    .from('rpg_master_notes')
    .delete()
    .eq('id', noteId)
    .eq('user_id', normalizedUserId)

  if (error) {
    throw error
  }

  clearSupabaseFetchCache(`${MASTER_NOTES_CACHE_PREFIX}:${normalizedUserId}:`)
  clearSupabaseFetchCache(`${MASTER_NOTES_CACHE_PREFIX}:detail:${normalizedUserId}:${noteId}`)
  clearSupabaseFetchCache(`${MASTER_NOTE_RECIPIENTS_CACHE_PREFIX}:${normalizedUserId}:${noteId}`)
  clearSupabaseFetchCache(`${SHARED_MASTER_NOTES_CACHE_PREFIX}:${normalizedUserId}`)
}

export async function listMasterNoteFolders(userId: string): Promise<MasterNoteFolder[]> {
  const client = ensureSupabase()
  const normalizedUserId = ensureUserId(userId)
  const cacheKey = `${MASTER_NOTE_FOLDERS_CACHE_PREFIX}:${normalizedUserId}`

  return runSupabaseFetch(
    cacheKey,
    { functionName: 'listMasterNoteFolders', table: 'rpg_master_note_folders' },
    async () => {
      const { data, error } = await client
        .from('rpg_master_note_folders')
        .select('id, user_id, name, parent_id, created_at, updated_at')
        .eq('user_id', normalizedUserId)
        .order('name', { ascending: true })
        .limit(300)

      if (error) {
        throw error
      }

      return ((data ?? []) as MasterNoteFolderRow[]).map(mapMasterNoteFolder)
    },
    { cacheMs: 4_000 },
  )
}

export async function createMasterNoteFolder({
  userId,
  name,
  parentId = null,
}: CreateMasterNoteFolderInput): Promise<MasterNoteFolder> {
  const client = ensureSupabase()
  const normalizedUserId = ensureUserId(userId)
  const trimmedName = name.trim()

  if (!trimmedName) {
    throw new Error('Nome da pasta invalido.')
  }

  const { data, error } = await client
    .from('rpg_master_note_folders')
    .insert({
      user_id: normalizedUserId,
      name: trimmedName,
      parent_id: normalizeFolderId(parentId),
    })
    .select('id, user_id, name, parent_id, created_at, updated_at')
    .single()

  if (error) {
    throw error
  }

  clearSupabaseFetchCache(`${MASTER_NOTE_FOLDERS_CACHE_PREFIX}:${normalizedUserId}`)
  clearSupabaseFetchCache(`${MASTER_NOTES_CACHE_PREFIX}:${normalizedUserId}:`)
  return mapMasterNoteFolder(data as MasterNoteFolderRow)
}

export async function listShareablePlayers(
  viewerProfile: Profile,
): Promise<ShareableMasterNotePlayer[]> {
  const profiles = await listSheetProfiles(viewerProfile)

  return profiles
    .filter((entry) => entry.id !== viewerProfile.id)
    .map((entry) => {
      const linkedUserId =
        entry.role !== 'gm' && !isNpcProfile(entry) && entry.id.trim()
          ? entry.id
          : null
      const canReceive = Boolean(linkedUserId)

      return {
        profileId: entry.id,
        displayName: entry.displayName,
        email: entry.email,
        handle: entry.handle,
        linkedUserId,
        canReceiveSharedNotes: canReceive,
      }
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
}

export async function listNoteRecipients(userId: string, noteId: string): Promise<MasterNoteRecipient[]> {
  const client = ensureSupabase()
  const normalizedUserId = ensureUserId(userId)
  const cacheKey = `${MASTER_NOTE_RECIPIENTS_CACHE_PREFIX}:${normalizedUserId}:${noteId}`

  return runSupabaseFetch(
    cacheKey,
    { functionName: 'listNoteRecipients', table: 'rpg_master_note_recipients' },
    async () => {
      const { data, error } = await client
        .from('rpg_master_note_recipients')
        .select('id, note_id, owner_user_id, recipient_user_id, created_at')
        .eq('owner_user_id', normalizedUserId)
        .eq('note_id', noteId)
        .order('created_at', { ascending: true })

      if (error) {
        throw error
      }

      return ((data ?? []) as MasterNoteRecipientRow[]).map(mapMasterNoteRecipient)
    },
    { cacheMs: 1_500 },
  )
}

export async function setNoteVisibilityAndRecipients(
  userId: string,
  noteId: string,
  visibility: MasterNoteVisibility,
  recipientUserIds: string[],
): Promise<MasterNote> {
  const client = ensureSupabase()
  const normalizedUserId = ensureUserId(userId)
  const normalizedRecipientUserIds =
    visibility === 'private'
      ? []
      : normalizeRecipientUserIds(recipientUserIds, normalizedUserId)

  const { data: noteData, error: noteError } = await client
    .from('rpg_master_notes')
    .update({
      visibility,
      updated_at: new Date().toISOString(),
    })
    .eq('id', noteId)
    .eq('user_id', normalizedUserId)
    .select('id, user_id, title, content, note_type, folder_id, tags, visibility, is_favorite, created_at, updated_at')
    .single()

  if (noteError) {
    throw noteError
  }

  const { error: deleteError } = await client
    .from('rpg_master_note_recipients')
    .delete()
    .eq('owner_user_id', normalizedUserId)
    .eq('note_id', noteId)

  if (deleteError) {
    throw deleteError
  }

  if (normalizedRecipientUserIds.length) {
    const { error: upsertError } = await client
      .from('rpg_master_note_recipients')
      .upsert(
        normalizedRecipientUserIds.map((recipientUserId) => ({
          note_id: noteId,
          owner_user_id: normalizedUserId,
          recipient_user_id: recipientUserId,
        })),
        { onConflict: 'note_id,recipient_user_id' },
      )

    if (upsertError) {
      throw upsertError
    }
  }

  clearSupabaseFetchCache(`${MASTER_NOTES_CACHE_PREFIX}:${normalizedUserId}:`)
  clearSupabaseFetchCache(`${MASTER_NOTES_CACHE_PREFIX}:detail:${normalizedUserId}:${noteId}`)
  clearSupabaseFetchCache(`${MASTER_NOTE_RECIPIENTS_CACHE_PREFIX}:${normalizedUserId}:${noteId}`)
  clearSupabaseFetchCache(`${SHARED_MASTER_NOTES_CACHE_PREFIX}:${normalizedUserId}`)

  return mapMasterNote(noteData as MasterNoteRow, normalizedUserId)
}

export async function listSharedMasterNotesForCurrentUser(
  userId: string,
): Promise<MasterNoteListItem[]> {
  const client = ensureSupabase()
  const normalizedUserId = ensureUserId(userId)
  const cacheKey = `${SHARED_MASTER_NOTES_CACHE_PREFIX}:${normalizedUserId}`

  return runSupabaseFetch(
    cacheKey,
    { functionName: 'listSharedMasterNotesForCurrentUser', table: 'rpg_master_notes' },
    async () => {
      const { data, error } = await client
        .from('rpg_master_notes')
        .select('id, user_id, title, note_type, folder_id, tags, visibility, is_favorite, created_at, updated_at')
        .neq('user_id', normalizedUserId)
        .in('visibility', ['all_players', 'selected_players'])
        .order('updated_at', { ascending: false })
        .limit(300)

      if (error) {
        throw error
      }

      return dedupeMasterNoteListItems(
        ((data ?? []) as MasterNoteRow[]).map((row) => mapMasterNoteListItem(row, normalizedUserId)),
      )
    },
    { cacheMs: 2_000 },
  )
}
