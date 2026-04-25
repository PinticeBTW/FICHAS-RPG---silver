import type { Profile, WebSheetRecord } from '../types/domain'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import {
  CYBERWARE_CATALOG_FIELD_KEY,
  cyberwareSheetFieldDefaults,
  cyberwareSheetFieldKeys,
} from './cyberwareSheetLayout'
import { pdfSheetTemplateFields } from './pdfSheetTemplate'
import { clearSupabaseFetchCache, logSupabaseFetch, runSupabaseFetch } from './supabaseQueries'

const CURRENT_TEMPLATE_KEY = 'blank-grey-v2'
const SHEET_RECORD_CACHE_LIMIT = 12
const GLOBAL_CYBERWARE_CATALOG_ID = 'global'
const GLOBAL_CYBERWARE_TEMPLATE_KEY = 'global-cyberware-v1'
const RECENT_LOCAL_NPC_WRITE_TTL_MS = 15_000

type ProfileRow = {
  id: string
  email: string
  display_name: string
  handle: string
  role: Profile['role']
  avatar_url: string | null
}

type SheetRow = {
  id: string
  profile_id: string
  template_key: string
  field_data: Record<string, unknown> | string | null
  updated_at: string | null
}

type SavedSheetRow = Omit<SheetRow, 'field_data'>

type SheetShareAccessRow = {
  viewer_profile_id: string
}

type GlobalCyberwareCatalogRow = {
  id: string
  catalog: unknown
  updated_at: string | null
}

type SavedGlobalCyberwareCatalogRow = Pick<GlobalCyberwareCatalogRow, 'id' | 'updated_at'>
type SavedNpcCardRow = Pick<NpcCardRow, 'id' | 'updated_at'>

type SheetProfileMetadata = Partial<
  Pick<
    Profile,
    | 'sheetAccess'
    | 'sheetSource'
    | 'ownerProfileId'
    | 'ownerDisplayName'
    | 'ownerEmail'
    | 'ownerSheetNumber'
  >
>

function ensureSupabase() {
  if (!supabase) {
    throw new Error(SUPABASE_CONFIG_ERROR)
  }

  return supabase
}

function sheetSharingErrorText(error: unknown) {
  if (!error || typeof error !== 'object') {
    return ''
  }

  const candidate = error as {
    message?: string
    details?: string
    hint?: string
    code?: string
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

export function isSheetSharingUnavailableError(error: unknown) {
  const text = sheetSharingErrorText(error)

  return (
    text.includes('sheet_share_access') ||
    text.includes('sheet_share_target_kind') ||
    text.includes('has_sheet_share_access') ||
    text.includes('42p01') ||
    text.includes('42883') ||
    text.includes('42704') ||
    text.includes('pgrst205')
  )
}

export function isGlobalCyberwareCatalogUnavailableError(error: unknown) {
  const text = sheetSharingErrorText(error)

  return (
    text.includes('cyberware_catalog_settings') ||
    text.includes('42p01') ||
    text.includes('42501') ||
    text.includes('pgrst205') ||
    text.includes('permission denied') ||
    text.includes('row-level security')
  )
}

function mapProfile(
  row: ProfileRow,
  metadata?: SheetProfileMetadata,
): Profile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    handle: row.handle,
    role: row.role,
    avatarUrl: row.avatar_url ?? undefined,
    sheetAccess: metadata?.sheetAccess,
    sheetSource: metadata?.sheetSource,
    ownerProfileId: metadata?.ownerProfileId,
    ownerDisplayName: metadata?.ownerDisplayName,
    ownerEmail: metadata?.ownerEmail,
    ownerSheetNumber: metadata?.ownerSheetNumber,
  }
}

const EXTRA_FIELD_KEYS = [
  'FOTO',
  'FOTO2',
  'GM_NOTES',
  'GM_NOTE_PAGES',
  'GM_REMINDERS',
  'PLAYER_MESSAGES',
  'PLAYER_NOTES',
  'PLAYER_NOTE_PAGES',
  'P5_RELATIONS',
  ...cyberwareSheetFieldKeys,
]

function buildInitialFieldData() {
  const initialFieldData = {
    ...Object.fromEntries(pdfSheetTemplateFields.map((field) => [field.name, ''])),
    ...cyberwareSheetFieldDefaults,
  } as Record<string, string>

  for (const key of EXTRA_FIELD_KEYS) {
    initialFieldData[key] = cyberwareSheetFieldDefaults[key] ?? ''
  }

  return initialFieldData
}

function parseSheetFieldData(fieldData: Record<string, unknown> | string | null) {
  if (!fieldData) {
    return {}
  }

  if (typeof fieldData === 'string') {
    try {
      const parsed = JSON.parse(fieldData)

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return {}
    }

    return {}
  }

  if (typeof fieldData === 'object' && !Array.isArray(fieldData)) {
    return fieldData
  }

  return {}
}

function coerceFieldValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (value == null) {
    return ''
  }

  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function normalizeFieldData(fieldData: Record<string, unknown> | string | null) {
  const parsedFieldData = parseSheetFieldData(fieldData)
  const nextFieldData = buildInitialFieldData()

  for (const [key, value] of Object.entries(parsedFieldData)) {
    nextFieldData[key] = coerceFieldValue(value)
  }

  return nextFieldData
}

function buildFieldDataPatch(
  nextFieldData: Record<string, string>,
  previousFieldData?: Record<string, string> | null,
) {
  if (!previousFieldData) {
    return null
  }

  const normalizedPrevious = normalizeFieldData(previousFieldData)
  const patch: Record<string, string> = {}
  const removedKeys: string[] = []

  for (const [key, value] of Object.entries(nextFieldData)) {
    if (normalizedPrevious[key] !== value) {
      patch[key] = value
    }
  }

  for (const key of Object.keys(normalizedPrevious)) {
    if (!(key in nextFieldData)) {
      removedKeys.push(key)
    }
  }

  return {
    patch,
    removedKeys,
    changedKeys: [...Object.keys(patch), ...removedKeys.map((key) => `-${key}`)],
  }
}

function getJsonSizeKb(value: unknown) {
  try {
    const json = JSON.stringify(value)
    return Number((new Blob([json]).size / 1024).toFixed(2))
  } catch {
    return 0
  }
}

function logNpcSave(message: string, value: unknown) {
  if (!import.meta.env.DEV) {
    return
  }

  console.debug(`[NPC_SAVE] ${message}`, value)
}

function isNpcPatchFunctionUnavailableError(error: unknown) {
  const text = sheetSharingErrorText(error)

  return (
    text.includes('patch_npc_card_field_data') ||
    text.includes('pgrst202') ||
    text.includes('42883') ||
    text.includes('could not find the function')
  )
}

const sheetRecordCache = new Map<string, WebSheetRecord>()
const sheetRecordCacheTimes = new Map<string, number>()
const recentLocalNpcWrites = new Map<string, Map<string, number>>()

function rememberRecentLocalNpcWrite(npcId: string, updatedAt: string | null | undefined) {
  if (!updatedAt) {
    return
  }

  const now = Date.now()
  const writes = recentLocalNpcWrites.get(npcId) ?? new Map<string, number>()
  writes.set(updatedAt, now)

  for (const [writtenAt, recordedAt] of writes.entries()) {
    if (now - recordedAt > RECENT_LOCAL_NPC_WRITE_TTL_MS) {
      writes.delete(writtenAt)
    }
  }

  recentLocalNpcWrites.set(npcId, writes)
}

function shouldSkipNpcPartialRefresh(
  npcId: string,
  updatedAt: string | null | undefined,
) {
  if (!updatedAt) {
    return false
  }

  const writes = recentLocalNpcWrites.get(npcId)

  if (!writes) {
    return false
  }

  const now = Date.now()

  for (const [writtenAt, recordedAt] of writes.entries()) {
    if (now - recordedAt > RECENT_LOCAL_NPC_WRITE_TTL_MS) {
      writes.delete(writtenAt)
    }
  }

  const matchedAt = writes.get(updatedAt)

  if (!matchedAt) {
    if (!writes.size) {
      recentLocalNpcWrites.delete(npcId)
    }
    return false
  }

  writes.delete(updatedAt)
  if (!writes.size) {
    recentLocalNpcWrites.delete(npcId)
  }
  return true
}

function cloneSheetRecord(record: WebSheetRecord): WebSheetRecord {
  return {
    ...record,
    fieldData: { ...record.fieldData },
  }
}

function rememberCachedSheetRecord(record: WebSheetRecord) {
  sheetRecordCache.delete(record.profileId)
  sheetRecordCacheTimes.delete(record.profileId)
  sheetRecordCache.set(record.profileId, cloneSheetRecord(record))
  sheetRecordCacheTimes.set(record.profileId, Date.now())

  if (sheetRecordCache.size > SHEET_RECORD_CACHE_LIMIT) {
    const oldestKey = sheetRecordCache.keys().next().value

    if (oldestKey) {
      sheetRecordCache.delete(oldestKey)
      sheetRecordCacheTimes.delete(oldestKey)
    }
  }

  return record
}

export function getCachedSheetRecord(profileId: string, maxAgeMs?: number) {
  const cachedAt = sheetRecordCacheTimes.get(profileId) ?? 0

  if (maxAgeMs && (!cachedAt || Date.now() - cachedAt > maxAgeMs)) {
    return null
  }

  const record = sheetRecordCache.get(profileId)
  return record ? cloneSheetRecord(record) : null
}

function mapSheet(row: SheetRow): WebSheetRecord {
  return rememberCachedSheetRecord({
    id: row.id,
    profileId: row.profile_id,
    templateKey: row.template_key,
    fieldData: normalizeFieldData(row.field_data),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  })
}

function mapSavedSheet(row: SavedSheetRow, fieldData: Record<string, string>): WebSheetRecord {
  return rememberCachedSheetRecord({
    id: row.id,
    profileId: row.profile_id,
    templateKey: row.template_key,
    fieldData,
    updatedAt: row.updated_at ?? new Date().toISOString(),
  })
}

export const NPC_EMAIL_PREFIX = 'npc:'

export function isNpcProfile(profile: Profile) {
  return profile.email.startsWith(NPC_EMAIL_PREFIX)
}

type NpcCardRow = {
  id: string
  display_name: string
  field_data?: Record<string, unknown> | string | null
  owner_profile_id?: string | null
  updated_at: string | null
}

function mapNpcProfile(
  row: NpcCardRow,
  metadata?: SheetProfileMetadata,
): Profile {
  return {
    id: row.id,
    email: `${NPC_EMAIL_PREFIX}${row.id}`,
    displayName: row.display_name,
    handle: row.id,
    role: 'player',
    sheetAccess: metadata?.sheetAccess,
    sheetSource: metadata?.sheetSource,
    ownerProfileId: metadata?.ownerProfileId ?? row.owner_profile_id ?? undefined,
    ownerDisplayName: metadata?.ownerDisplayName,
    ownerEmail: metadata?.ownerEmail,
    ownerSheetNumber: metadata?.ownerSheetNumber,
  }
}

function mapNpcSheet(row: NpcCardRow): WebSheetRecord {
  return rememberCachedSheetRecord({
    id: row.id,
    profileId: row.id,
    templateKey: CURRENT_TEMPLATE_KEY,
    fieldData: normalizeFieldData(row.field_data ?? null),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  })
}

function mapSavedNpcSheet(row: SavedNpcCardRow, fieldData: Record<string, string>): WebSheetRecord {
  const updatedAt = row.updated_at ?? new Date().toISOString()
  rememberRecentLocalNpcWrite(row.id, updatedAt)

  return rememberCachedSheetRecord({
    id: row.id,
    profileId: row.id,
    templateKey: CURRENT_TEMPLATE_KEY,
    fieldData,
    updatedAt,
  })
}

function stringifyGlobalCyberwareCatalog(catalog: unknown) {
  if (Array.isArray(catalog)) {
    return JSON.stringify(catalog)
  }

  if (typeof catalog === 'string') {
    try {
      const parsed = JSON.parse(catalog) as unknown
      return Array.isArray(parsed) ? JSON.stringify(parsed) : '[]'
    } catch {
      return '[]'
    }
  }

  return '[]'
}

function parseGlobalCyberwareCatalogValue(value: string | undefined) {
  if (!value?.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mapGlobalCyberwareCatalog(row?: GlobalCyberwareCatalogRow | null): WebSheetRecord {
  return {
    id: row?.id ?? GLOBAL_CYBERWARE_CATALOG_ID,
    profileId: GLOBAL_CYBERWARE_CATALOG_ID,
    templateKey: GLOBAL_CYBERWARE_TEMPLATE_KEY,
    fieldData: {
      [CYBERWARE_CATALOG_FIELD_KEY]: stringifyGlobalCyberwareCatalog(row?.catalog ?? []),
    },
    updatedAt: row?.updated_at ?? new Date().toISOString(),
  }
}

function mapSavedGlobalCyberwareCatalog(
  row: SavedGlobalCyberwareCatalogRow,
  fieldData: Record<string, string>,
): WebSheetRecord {
  return {
    id: row.id,
    profileId: GLOBAL_CYBERWARE_CATALOG_ID,
    templateKey: GLOBAL_CYBERWARE_TEMPLATE_KEY,
    fieldData: {
      [CYBERWARE_CATALOG_FIELD_KEY]: fieldData[CYBERWARE_CATALOG_FIELD_KEY] ?? '[]',
    },
    updatedAt: row.updated_at ?? new Date().toISOString(),
  }
}

function resolveSheetAccessMetadata(entry: Profile, viewer: Profile) {
  const isShared = viewer.role !== 'gm' && (isNpcProfile(entry) || entry.id !== viewer.id)

  return {
    sheetAccess: isShared ? 'shared' : 'owner',
    sheetSource: isNpcProfile(entry) ? 'npc' : 'profile',
  } as const
}

function resolveNpcSheetAccessMetadata(entry: NpcCardRow, viewer: Profile) {
  return {
    sheetAccess:
      viewer.role !== 'gm' && entry.owner_profile_id !== viewer.id
        ? 'shared'
        : 'owner',
    sheetSource: 'npc',
  } as const
}

function isNpcOwnerColumnUnavailableError(error: unknown) {
  const text = sheetSharingErrorText(error)
  return text.includes('owner_profile_id') || text.includes('pgrst204')
}

function resolveShareTarget(entry: Profile) {
  return {
    targetKind: isNpcProfile(entry) ? 'npc' : 'profile',
    targetId: entry.id,
  } as const
}

function sortAccessibleProfiles(left: Profile, right: Profile) {
  if (left.sheetAccess !== right.sheetAccess) {
    return left.sheetAccess === 'owner' ? -1 : 1
  }

  return left.displayName.localeCompare(right.displayName)
}

async function listNpcCards(client: ReturnType<typeof ensureSupabase>): Promise<NpcCardRow[]> {
  logSupabaseFetch({ functionName: 'listSheetProfiles', table: 'npc_cards' })

  const result = await client
    .from('npc_cards')
    .select('id, display_name, owner_profile_id, updated_at')
    .order('display_name', { ascending: true })
    .limit(500)

  if (!result.error) {
    return (result.data ?? []) as NpcCardRow[]
  }

  if (!isNpcOwnerColumnUnavailableError(result.error)) {
    throw result.error
  }

  const fallbackResult = await client
    .from('npc_cards')
    .select('id, display_name, updated_at')
    .order('display_name', { ascending: true })
    .limit(500)

  if (fallbackResult.error) {
    throw fallbackResult.error
  }

  return ((fallbackResult.data ?? []) as NpcCardRow[]).map((entry) => ({
    ...entry,
    owner_profile_id: null,
  }))
}

export async function listSheetProfiles(viewer: Profile) {
  const client = ensureSupabase()
  return runSupabaseFetch(
    `listSheetProfiles:${viewer.id}:${viewer.role}`,
    { functionName: 'listSheetProfiles', table: 'profiles,npc_cards' },
    async () => {
      logSupabaseFetch({ functionName: 'listSheetProfiles', table: 'profiles' })

      const [profilesResult, npcsResult] = await Promise.all([
        client
          .from('profiles')
          .select('id, email, display_name, handle, role, avatar_url')
          .order('display_name', { ascending: true })
          .limit(500),
        listNpcCards(client),
      ])

      if (profilesResult.error) throw profilesResult.error

      const profiles = ((profilesResult.data ?? []) as ProfileRow[]).map((entry) => {
        const baseProfile = mapProfile(entry)
        return {
          ...baseProfile,
          ...resolveSheetAccessMetadata(baseProfile, viewer),
        }
      })
      const profileById = new Map(profiles.map((entry) => [entry.id, entry]))
      const ownedNpcCountByOwner = new Map<string, number>()
      const npcs = npcsResult.map((entry) => {
        const ownerProfile = entry.owner_profile_id
          ? profileById.get(entry.owner_profile_id) ?? null
          : null
        const ownerSheetNumber = ownerProfile
          ? (ownedNpcCountByOwner.get(ownerProfile.id) ?? 0) + 2
          : undefined

        if (ownerProfile) {
          ownedNpcCountByOwner.set(
            ownerProfile.id,
            (ownedNpcCountByOwner.get(ownerProfile.id) ?? 0) + 1,
          )
        }

        const baseProfile = mapNpcProfile(entry, {
          ownerProfileId: entry.owner_profile_id ?? undefined,
          ownerDisplayName: ownerProfile?.displayName,
          ownerEmail: ownerProfile?.email,
          ownerSheetNumber,
        })
        return {
          ...baseProfile,
          ...resolveNpcSheetAccessMetadata(entry, viewer),
        }
      })

      return [...profiles, ...npcs].sort(sortAccessibleProfiles)
    },
  )
}

export async function createNpcCard(displayName: string, ownerProfileId?: string): Promise<Profile> {
  const client = ensureSupabase()
  const insertPayload = {
    display_name: displayName,
    field_data: buildInitialFieldData(),
    ...(ownerProfileId ? { owner_profile_id: ownerProfileId } : {}),
  }

  logSupabaseFetch({ functionName: 'createNpcCard', table: 'npc_cards' })

  const { data, error } = await client
    .from('npc_cards')
    .insert(insertPayload)
    .select('id, display_name, owner_profile_id, updated_at')
    .single()

  if (error) {
    if (!ownerProfileId || !isNpcOwnerColumnUnavailableError(error)) {
      throw error
    }

    const fallbackResult = await client
      .from('npc_cards')
      .insert({ display_name: displayName, field_data: buildInitialFieldData() })
      .select('id, display_name, updated_at')
      .single()

    if (fallbackResult.error) {
      throw fallbackResult.error
    }

    clearSupabaseFetchCache('listSheetProfiles:')
    return mapNpcProfile(fallbackResult.data as NpcCardRow)
  }

  clearSupabaseFetchCache('listSheetProfiles:')
  return mapNpcProfile(data as NpcCardRow)
}

export async function updateProfileDisplayName(profileId: string, displayName: string): Promise<void> {
  const client = ensureSupabase()
  const trimmed = displayName.trim()

  if (!trimmed) {
    return
  }

  logSupabaseFetch({ functionName: 'updateProfileDisplayName', table: 'profiles' })

  const { data, error } = await client
    .from('profiles')
    .update({ display_name: trimmed })
    .eq('id', profileId)
    .select('id, display_name')
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    throw new Error('Nao foi possivel guardar o novo nome deste perfil no Supabase.')
  }

  clearSupabaseFetchCache('listSheetProfiles:')
}

export async function updateNpcCardDisplayName(npcId: string, displayName: string): Promise<void> {
  const client = ensureSupabase()
  const trimmed = displayName.trim()

  if (!trimmed) {
    return
  }

  logSupabaseFetch({ functionName: 'updateNpcCardDisplayName', table: 'npc_cards' })

  const { data, error } = await client
    .from('npc_cards')
    .update({ display_name: trimmed, updated_at: new Date().toISOString() })
    .eq('id', npcId)
    .select('id, display_name')
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    throw new Error('Nao foi possivel guardar o novo nome desta ficha no Supabase.')
  }

  clearSupabaseFetchCache('listSheetProfiles:')
}

export async function fetchNpcSheet(npcId: string): Promise<WebSheetRecord> {
  const client = ensureSupabase()

  return runSupabaseFetch(
    `fetchNpcSheet:${npcId}`,
    { functionName: 'fetchNpcSheet', table: 'npc_cards' },
    async () => {
      const { data, error } = await client
        .from('npc_cards')
        .select('id, display_name, field_data, updated_at')
        .eq('id', npcId)
        .single()

      if (error) throw error
      return mapNpcSheet(data as NpcCardRow)
    },
  )
}

type FetchSheetSnapshotOptions = {
  preferCache?: boolean
  cacheMaxAgeMs?: number
}

export async function fetchSheetSnapshot(
  profile: Profile,
  options: FetchSheetSnapshotOptions = {},
): Promise<WebSheetRecord | null> {
  const client = ensureSupabase()
  const cachedRecord = options.preferCache
    ? getCachedSheetRecord(profile.id, options.cacheMaxAgeMs)
    : null

  if (cachedRecord) {
    return cachedRecord
  }

  if (isNpcProfile(profile)) {
    return runSupabaseFetch(
      `fetchSheetSnapshot:npc:${profile.id}`,
      { functionName: 'fetchSheetSnapshot', table: 'npc_cards' },
      async () => {
        const { data, error } = await client
          .from('npc_cards')
          .select('id, display_name, field_data, updated_at')
          .eq('id', profile.id)
          .maybeSingle()

        if (error) throw error
        return data ? mapNpcSheet(data as NpcCardRow) : null
      },
    )
  }

  return runSupabaseFetch(
    `fetchSheetSnapshot:profile:${profile.id}`,
    { functionName: 'fetchSheetSnapshot', table: 'character_sheet_forms' },
    async () => {
      const { data, error } = await client
        .from('character_sheet_forms')
        .select('id, profile_id, template_key, field_data, updated_at')
        .eq('profile_id', profile.id)
        .maybeSingle()

      if (error) throw error
      return data ? mapSheet(data as SheetRow) : null
    },
  )
}

export async function deleteNpcCard(npcId: string): Promise<void> {
  const client = ensureSupabase()
  logSupabaseFetch({ functionName: 'deleteNpcCard', table: 'npc_cards' })
  const { error } = await client.from('npc_cards').delete().eq('id', npcId)
  if (error) throw error
  clearSupabaseFetchCache('listSheetProfiles:')
}

type SaveNpcSheetOptions = {
  previousFieldData?: Record<string, string> | null
  currentUpdatedAt?: string | null
}

async function saveNpcSheetFullPayload(
  npcId: string,
  normalizedFieldData: Record<string, string>,
): Promise<SavedNpcCardRow> {
  const client = ensureSupabase()
  const payload = {
    field_data: normalizedFieldData,
    updated_at: new Date().toISOString(),
  }

  logNpcSave('payload size:', `${getJsonSizeKb(payload)} KB`)
  logNpcSave('fields:', Object.keys(payload))

  const startedAt = performance.now()
  const { data, error } = await client
    .from('npc_cards')
    .update(payload)
    .eq('id', npcId)
    .select('id, updated_at')
    .maybeSingle()

  logNpcSave('duration:', `${Math.round(performance.now() - startedAt)} ms`)

  if (error) throw error
  if (!data) {
    throw new Error('O Supabase bloqueou a gravacao desta ficha extra.')
  }

  return data as SavedNpcCardRow
}

async function saveNpcSheetPatchPayload(
  npcId: string,
  patch: Record<string, string>,
  removedKeys: string[],
): Promise<SavedNpcCardRow> {
  const client = ensureSupabase()
  const payload = {
    p_npc_id: npcId,
    p_field_patch: patch,
    p_removed_keys: removedKeys,
  }

  logNpcSave('payload size:', `${getJsonSizeKb(payload)} KB`)
  logNpcSave('fields:', Object.keys(patch).concat(removedKeys.map((key) => `-${key}`)))

  const startedAt = performance.now()
  const { data, error } = await client
    .rpc('patch_npc_card_field_data', payload)
    .maybeSingle()

  logNpcSave('duration:', `${Math.round(performance.now() - startedAt)} ms`)

  if (error) throw error
  if (!data) {
    throw new Error('O Supabase bloqueou a gravacao desta ficha extra.')
  }

  return data as SavedNpcCardRow
}

export async function saveNpcSheet(
  npcId: string,
  fieldData: Record<string, string>,
  options: SaveNpcSheetOptions = {},
): Promise<WebSheetRecord> {
  const normalizedFieldData = normalizeFieldData(fieldData)
  const fieldPatch = buildFieldDataPatch(normalizedFieldData, options.previousFieldData)
  logSupabaseFetch({ functionName: 'saveNpcSheet', table: 'npc_cards' })

  if (fieldPatch && !fieldPatch.changedKeys.length) {
    return mapSavedNpcSheet(
      { id: npcId, updated_at: options.currentUpdatedAt ?? new Date().toISOString() },
      normalizedFieldData,
    )
  }

  if (fieldPatch) {
    try {
      const savedPatch = await saveNpcSheetPatchPayload(npcId, fieldPatch.patch, fieldPatch.removedKeys)
      return mapSavedNpcSheet(savedPatch, normalizedFieldData)
    } catch (error) {
      if (!isNpcPatchFunctionUnavailableError(error)) {
        throw error
      }

      logNpcSave('patch fallback:', 'patch_npc_card_field_data unavailable; using full field_data update')
    }
  }

  const savedFull = await saveNpcSheetFullPayload(npcId, normalizedFieldData)
  return mapSavedNpcSheet(savedFull, normalizedFieldData)
}

export async function fetchOrCreateSheet(profile: Profile) {
  const client = ensureSupabase()

  return runSupabaseFetch(
    `fetchOrCreateSheet:${profile.id}`,
    { functionName: 'fetchOrCreateSheet', table: 'character_sheet_forms' },
    async () => {
      const { data, error } = await client
        .from('character_sheet_forms')
        .select('id, profile_id, template_key, field_data, updated_at')
        .eq('profile_id', profile.id)
        .maybeSingle()

      if (error) {
        throw error
      }

      if (data) {
        const existingSheet = data as SheetRow

        if (existingSheet.template_key !== CURRENT_TEMPLATE_KEY) {
          const migratedFieldData = normalizeFieldData(existingSheet.field_data)
          const { data: migrated, error: migrationError } = await client
            .from('character_sheet_forms')
            .update({
              template_key: CURRENT_TEMPLATE_KEY,
              field_data: migratedFieldData,
            })
            .eq('id', existingSheet.id)
            .select('id, profile_id, template_key, field_data, updated_at')
            .single()

          if (migrationError) {
            throw migrationError
          }

          return mapSheet(migrated as SheetRow)
        }

        return mapSheet(data as SheetRow)
      }

      const { data: inserted, error: insertError } = await client
        .from('character_sheet_forms')
        .insert({
          profile_id: profile.id,
          template_key: CURRENT_TEMPLATE_KEY,
          field_data: buildInitialFieldData(),
        })
        .select('id, profile_id, template_key, field_data, updated_at')
        .single()

      if (insertError) {
        throw insertError
      }

      return mapSheet(inserted as SheetRow)
    },
    { maxRetries: 0 },
  )
}

export async function saveSheetFields(profileId: string, fieldData: Record<string, string>) {
  const client = ensureSupabase()
  const normalizedFieldData = normalizeFieldData(fieldData)
  logSupabaseFetch({ functionName: 'saveSheetFields', table: 'character_sheet_forms' })

  const { data, error } = await client
    .from('character_sheet_forms')
    .upsert(
      {
        profile_id: profileId,
        template_key: CURRENT_TEMPLATE_KEY,
        field_data: normalizedFieldData,
      },
      { onConflict: 'profile_id' },
    )
    .select('id, profile_id, template_key, updated_at')
    .single()

  if (error) {
    throw error
  }

  return mapSavedSheet(data as SavedSheetRow, normalizedFieldData)
}

export async function fetchGlobalCyberwareCatalog(): Promise<WebSheetRecord> {
  const client = ensureSupabase()
  return runSupabaseFetch(
    `fetchGlobalCyberwareCatalog:${GLOBAL_CYBERWARE_CATALOG_ID}`,
    { functionName: 'fetchGlobalCyberwareCatalog', table: 'cyberware_catalog_settings' },
    async () => {
      const { data, error } = await client
        .from('cyberware_catalog_settings')
        .select('id, catalog, updated_at')
        .eq('id', GLOBAL_CYBERWARE_CATALOG_ID)
        .maybeSingle()

      if (error) {
        throw error
      }

      return mapGlobalCyberwareCatalog(data as GlobalCyberwareCatalogRow | null)
    },
  )
}

export async function saveGlobalCyberwareCatalog(
  fieldData: Record<string, string>,
): Promise<WebSheetRecord> {
  const client = ensureSupabase()
  const normalizedFieldData = {
    [CYBERWARE_CATALOG_FIELD_KEY]: fieldData[CYBERWARE_CATALOG_FIELD_KEY] ?? '[]',
  }
  logSupabaseFetch({ functionName: 'saveGlobalCyberwareCatalog', table: 'cyberware_catalog_settings' })

  const { data, error } = await client
    .from('cyberware_catalog_settings')
    .upsert(
      {
        id: GLOBAL_CYBERWARE_CATALOG_ID,
        catalog: parseGlobalCyberwareCatalogValue(normalizedFieldData[CYBERWARE_CATALOG_FIELD_KEY]),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    .select('id, updated_at')
    .single()

  if (error) {
    throw error
  }

  return mapSavedGlobalCyberwareCatalog(data as SavedGlobalCyberwareCatalogRow, normalizedFieldData)
}

async function fetchRealtimeSheetByProfileId(profileId: string) {
  const client = ensureSupabase()
  return runSupabaseFetch(
    `fetchRealtimeSheetByProfileId:${profileId}`,
    { functionName: 'fetchRealtimeSheetByProfileId', table: 'character_sheet_forms' },
    async () => {
      const { data, error } = await client
        .from('character_sheet_forms')
        .select('id, profile_id, template_key, field_data, updated_at')
        .eq('profile_id', profileId)
        .maybeSingle()

      if (error || !data) {
        return null
      }

      return mapSheet(data as SheetRow)
    },
  )
}

async function fetchRealtimeNpcSheetById(npcId: string) {
  const client = ensureSupabase()
  return runSupabaseFetch(
    `fetchRealtimeNpcSheetById:${npcId}`,
    { functionName: 'fetchRealtimeNpcSheetById', table: 'npc_cards' },
    async () => {
      const { data, error } = await client
        .from('npc_cards')
        .select('id, display_name, field_data, updated_at')
        .eq('id', npcId)
        .maybeSingle()

      if (error || !data) {
        return null
      }

      return mapNpcSheet(data as NpcCardRow)
    },
  )
}

async function fetchRealtimeGlobalCyberwareCatalog() {
  try {
    return await fetchGlobalCyberwareCatalog()
  } catch {
    return null
  }
}

export async function listSheetShareViewerIds(target: Profile) {
  const client = ensureSupabase()
  const { targetKind, targetId } = resolveShareTarget(target)
  return runSupabaseFetch(
    `listSheetShareViewerIds:${targetKind}:${targetId}`,
    { functionName: 'listSheetShareViewerIds', table: 'sheet_share_access' },
    async () => {
      const { data, error } = await client
        .from('sheet_share_access')
        .select('viewer_profile_id')
        .eq('target_kind', targetKind)
        .eq('target_id', targetId)
        .limit(500)

      if (error) {
        throw error
      }

      return [...new Set(((data ?? []) as SheetShareAccessRow[]).map((entry) => entry.viewer_profile_id))]
    },
  )
}

export async function updateSheetShareAccess(target: Profile, viewerIds: string[]) {
  const client = ensureSupabase()
  const { targetKind, targetId } = resolveShareTarget(target)
  const normalizedViewerIds = [...new Set(viewerIds)]
    .filter(Boolean)
    .filter((viewerId) => targetKind === 'npc' || viewerId !== targetId)

  logSupabaseFetch({ functionName: 'updateSheetShareAccess', table: 'sheet_share_access' })

  const { error: deleteError } = await client
    .from('sheet_share_access')
    .delete()
    .eq('target_kind', targetKind)
    .eq('target_id', targetId)

  if (deleteError) {
    throw deleteError
  }

  clearSupabaseFetchCache(`listSheetShareViewerIds:${targetKind}:${targetId}`)
  clearSupabaseFetchCache('listSheetProfiles:')

  if (!normalizedViewerIds.length) {
    return
  }

  const { error: insertError } = await client.from('sheet_share_access').insert(
    normalizedViewerIds.map((viewerProfileId) => ({
      viewer_profile_id: viewerProfileId,
      target_kind: targetKind,
      target_id: targetId,
    })),
  )

  if (insertError) {
    throw insertError
  }
}

function createRealtimeChannelId(prefix: string) {
  const channelId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)

  return `${prefix}:${Date.now()}:${channelId}`
}

function createRealtimeRefreshRunner<T>(
  fetchLatest: () => Promise<T | null>,
  onChange: (value: T) => void,
) {
  let disposed = false
  let inFlight = false
  let queued = false
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const scheduleRefresh = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      timeoutId = null

      if (disposed) {
        return
      }

      if (inFlight) {
        queued = true
        return
      }

      inFlight = true
      void fetchLatest()
        .then((nextValue) => {
          if (!nextValue || disposed) {
            return
          }

          onChange(nextValue)
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false

          if (queued && !disposed) {
            queued = false
            scheduleRefresh()
          }
        })
    }, 600)
  }

  return {
    scheduleRefresh,
    dispose() {
      disposed = true
      queued = false

      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    },
  }
}

export function subscribeToSheet(
  profileId: string,
  onChange: (sheet: WebSheetRecord) => void,
) {
  const client = ensureSupabase()
  const refreshRunner = createRealtimeRefreshRunner(
    () => fetchRealtimeSheetByProfileId(profileId),
    onChange,
  )
  const channel = client
    .channel(createRealtimeChannelId(`character-sheet-form:${profileId}`))
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'character_sheet_forms',
        filter: `profile_id=eq.${profileId}`,
      },
      (payload) => {
        if (payload.eventType !== 'DELETE' && payload.new) {
          const nextRow = payload.new as Partial<SheetRow>

          // Some realtime UPDATE payloads may omit heavy columns like field_data.
          // Avoid replacing the current sheet with blanks when the payload is partial.
          if (typeof nextRow.field_data !== 'undefined') {
            onChange(mapSheet(nextRow as SheetRow))
            return
          }
        }

        refreshRunner.scheduleRefresh()
      },
    )
    .subscribe()

  return () => {
    refreshRunner.dispose()
    void client.removeChannel(channel)
  }
}

export function subscribeToNpcSheet(
  npcId: string,
  onChange: (sheet: WebSheetRecord) => void,
) {
  const client = ensureSupabase()
  const refreshRunner = createRealtimeRefreshRunner(
    () => fetchRealtimeNpcSheetById(npcId),
    onChange,
  )
  const channel = client
    .channel(createRealtimeChannelId(`npc-sheet:${npcId}`))
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'npc_cards',
        filter: `id=eq.${npcId}`,
      },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          return
        }

        if (payload.new) {
          const nextRow = payload.new as Partial<NpcCardRow>

          // Some realtime UPDATE payloads may omit heavy columns like field_data.
          // Avoid replacing the current sheet with blanks when the payload is partial.
          if (typeof nextRow.field_data !== 'undefined') {
            onChange(mapNpcSheet(nextRow as NpcCardRow))
            return
          }

          if (shouldSkipNpcPartialRefresh(npcId, nextRow.updated_at)) {
            return
          }
        }

        refreshRunner.scheduleRefresh()
      },
    )
    .subscribe()

  return () => {
    refreshRunner.dispose()
    void client.removeChannel(channel)
  }
}

export function subscribeToGlobalCyberwareCatalog(
  onChange: (catalog: WebSheetRecord) => void,
) {
  const client = ensureSupabase()
  const refreshRunner = createRealtimeRefreshRunner(
    fetchRealtimeGlobalCyberwareCatalog,
    onChange,
  )
  const channel = client
    .channel(createRealtimeChannelId('global-cyberware-catalog'))
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'cyberware_catalog_settings',
        filter: `id=eq.${GLOBAL_CYBERWARE_CATALOG_ID}`,
      },
      (payload) => {
        if (payload.eventType !== 'DELETE' && payload.new) {
          const nextRow = payload.new as Partial<GlobalCyberwareCatalogRow>

          if (typeof nextRow.catalog !== 'undefined') {
            onChange(mapGlobalCyberwareCatalog(nextRow as GlobalCyberwareCatalogRow))
            return
          }
        }

        refreshRunner.scheduleRefresh()
      },
    )
    .subscribe()

  return () => {
    refreshRunner.dispose()
    void client.removeChannel(channel)
  }
}

export function subscribeToSheetDirectory(onChange: () => void) {
  const client = ensureSupabase()
  const channel = client
    .channel(createRealtimeChannelId('sheet-directory'))
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'profiles',
      },
      () => {
        onChange()
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'npc_cards',
      },
      () => {
        onChange()
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'npc_cards',
      },
      (payload) => {
        const oldRow = payload.old as Partial<NpcCardRow>
        const newRow = payload.new as Partial<NpcCardRow>

        if (
          oldRow.display_name !== undefined &&
          newRow.display_name !== oldRow.display_name
        ) {
          onChange()
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'npc_cards',
      },
      () => {
        onChange()
      },
    )
    .subscribe()

  return () => {
    void client.removeChannel(channel)
  }
}

export function subscribeToSheetShareAccess(onChange: () => void) {
  const client = ensureSupabase()
  const channel = client
    .channel(createRealtimeChannelId('sheet-share-access'))
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'sheet_share_access',
      },
      () => {
        onChange()
      },
    )
    .subscribe()

  return () => {
    void client.removeChannel(channel)
  }
}

export type ProfileGroup = { id: string; name: string; profileIds: string[] }

export async function loadGmGroups(profileId: string): Promise<ProfileGroup[]> {
  const client = ensureSupabase()
  return runSupabaseFetch(
    `loadGmGroups:${profileId}`,
    { functionName: 'loadGmGroups', table: 'gm_settings' },
    async () => {
      const { data, error } = await client
        .from('gm_settings')
        .select('groups')
        .eq('profile_id', profileId)
        .maybeSingle()

      if (error) throw error
      if (!data) return []
      return (data.groups as ProfileGroup[]) ?? []
    },
  )
}

export async function saveGmGroups(profileId: string, groups: ProfileGroup[]): Promise<void> {
  const client = ensureSupabase()
  logSupabaseFetch({ functionName: 'saveGmGroups', table: 'gm_settings' })

  const { error } = await client
    .from('gm_settings')
    .upsert({ profile_id: profileId, groups, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' })

  if (error) throw error
  clearSupabaseFetchCache(`loadGmGroups:${profileId}`)
}
