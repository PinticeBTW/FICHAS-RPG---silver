import type { Profile, WebSheetRecord } from '../types/domain'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import { cyberwareSheetFieldDefaults, cyberwareSheetFieldKeys } from './cyberwareSheetLayout'
import { pdfSheetTemplateFields } from './pdfSheetTemplate'

const CURRENT_TEMPLATE_KEY = 'blank-grey-v2'

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

type SavedSheetRow = Pick<SheetRow, 'id' | 'profile_id' | 'template_key' | 'updated_at'>

type SheetShareAccessRow = {
  viewer_profile_id: string
}

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

function mapProfile(
  row: ProfileRow,
  metadata?: Pick<Profile, 'sheetAccess' | 'sheetSource'>,
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

function mapSheet(row: SheetRow): WebSheetRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    templateKey: row.template_key,
    fieldData: normalizeFieldData(row.field_data),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  }
}

export const NPC_EMAIL_PREFIX = 'npc:'

export function isNpcProfile(profile: Profile) {
  return profile.email.startsWith(NPC_EMAIL_PREFIX)
}

type NpcCardRow = {
  id: string
  display_name: string
  field_data: Record<string, unknown> | string | null
  updated_at: string | null
}

type SavedNpcCardRow = Pick<NpcCardRow, 'id' | 'updated_at'>

function mapNpcProfile(
  row: NpcCardRow,
  metadata?: Pick<Profile, 'sheetAccess' | 'sheetSource'>,
): Profile {
  return {
    id: row.id,
    email: `${NPC_EMAIL_PREFIX}${row.id}`,
    displayName: row.display_name,
    handle: row.id,
    role: 'player',
    sheetAccess: metadata?.sheetAccess,
    sheetSource: metadata?.sheetSource,
  }
}

function mapNpcSheet(row: NpcCardRow): WebSheetRecord {
  return {
    id: row.id,
    profileId: row.id,
    templateKey: CURRENT_TEMPLATE_KEY,
    fieldData: normalizeFieldData(row.field_data),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  }
}

function buildSavedSheetRecord(
  row: SavedSheetRow,
  fieldData: Record<string, string>,
): WebSheetRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    templateKey: row.template_key,
    fieldData,
    updatedAt: row.updated_at ?? new Date().toISOString(),
  }
}

function buildSavedNpcSheetRecord(
  row: SavedNpcCardRow,
  fieldData: Record<string, string>,
): WebSheetRecord {
  return {
    id: row.id,
    profileId: row.id,
    templateKey: CURRENT_TEMPLATE_KEY,
    fieldData,
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

export async function listSheetProfiles(viewer: Profile) {
  const client = ensureSupabase()
  const [profilesResult, npcsResult] = await Promise.all([
    client
      .from('profiles')
      .select('id, email, display_name, handle, role, avatar_url')
      .order('display_name', { ascending: true }),
    client
      .from('npc_cards')
      .select('id, display_name, field_data, updated_at')
      .order('display_name', { ascending: true }),
  ])

  if (profilesResult.error) throw profilesResult.error
  if (npcsResult.error) throw npcsResult.error

  const profiles = ((profilesResult.data ?? []) as ProfileRow[]).map((entry) => {
    const baseProfile = mapProfile(entry)
    return {
      ...baseProfile,
      ...resolveSheetAccessMetadata(baseProfile, viewer),
    }
  })
  const npcs = ((npcsResult.data ?? []) as NpcCardRow[]).map((entry) => {
    const baseProfile = mapNpcProfile(entry)
    return {
      ...baseProfile,
      ...resolveSheetAccessMetadata(baseProfile, viewer),
    }
  })

  return [...profiles, ...npcs].sort(sortAccessibleProfiles)
}

export async function createNpcCard(displayName: string): Promise<Profile> {
  const client = ensureSupabase()
  const { data, error } = await client
    .from('npc_cards')
    .insert({ display_name: displayName, field_data: buildInitialFieldData() })
    .select('id, display_name, field_data, updated_at')
    .single()

  if (error) throw error
  return mapNpcProfile(data as NpcCardRow)
}

export async function updateProfileDisplayName(profileId: string, displayName: string): Promise<void> {
  const client = ensureSupabase()
  const trimmed = displayName.trim()

  if (!trimmed) {
    return
  }

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
}

export async function updateNpcCardDisplayName(npcId: string, displayName: string): Promise<void> {
  const client = ensureSupabase()
  const trimmed = displayName.trim()

  if (!trimmed) {
    return
  }

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
}

export async function fetchNpcSheet(npcId: string): Promise<WebSheetRecord> {
  const client = ensureSupabase()
  const { data, error } = await client
    .from('npc_cards')
    .select('id, display_name, field_data, updated_at')
    .eq('id', npcId)
    .single()

  if (error) throw error
  return mapNpcSheet(data as NpcCardRow)
}

export async function fetchSheetSnapshot(profile: Profile): Promise<WebSheetRecord | null> {
  const client = ensureSupabase()

  if (isNpcProfile(profile)) {
    const { data, error } = await client
      .from('npc_cards')
      .select('id, display_name, field_data, updated_at')
      .eq('id', profile.id)
      .maybeSingle()

    if (error) throw error
    return data ? mapNpcSheet(data as NpcCardRow) : null
  }

  const { data, error } = await client
    .from('character_sheet_forms')
    .select('id, profile_id, template_key, field_data, updated_at')
    .eq('profile_id', profile.id)
    .maybeSingle()

  if (error) throw error
  return data ? mapSheet(data as SheetRow) : null
}

export async function deleteNpcCard(npcId: string): Promise<void> {
  const client = ensureSupabase()
  const { error } = await client.from('npc_cards').delete().eq('id', npcId)
  if (error) throw error
}

export async function saveNpcSheet(npcId: string, fieldData: Record<string, string>): Promise<WebSheetRecord> {
  const client = ensureSupabase()
  const normalizedFieldData = normalizeFieldData(fieldData)
  const { data, error } = await client
    .from('npc_cards')
    .update({ field_data: normalizedFieldData, updated_at: new Date().toISOString() })
    .eq('id', npcId)
    .select('id, updated_at')
    .single()

  if (error) throw error
  return buildSavedNpcSheetRecord(data as SavedNpcCardRow, normalizedFieldData)
}

export async function fetchOrCreateSheet(profile: Profile) {
  const client = ensureSupabase()
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
}

export async function saveSheetFields(profileId: string, fieldData: Record<string, string>) {
  const client = ensureSupabase()
  const normalizedFieldData = normalizeFieldData(fieldData)
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

  return buildSavedSheetRecord(data as SavedSheetRow, normalizedFieldData)
}

async function fetchRealtimeSheetByProfileId(profileId: string) {
  const client = ensureSupabase()
  const { data, error } = await client
    .from('character_sheet_forms')
    .select('id, profile_id, template_key, field_data, updated_at')
    .eq('profile_id', profileId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return mapSheet(data as SheetRow)
}

async function fetchRealtimeNpcSheetById(npcId: string) {
  const client = ensureSupabase()
  const { data, error } = await client
    .from('npc_cards')
    .select('id, display_name, field_data, updated_at')
    .eq('id', npcId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return mapNpcSheet(data as NpcCardRow)
}

export async function listSheetShareViewerIds(target: Profile) {
  const client = ensureSupabase()
  const { targetKind, targetId } = resolveShareTarget(target)
  const { data, error } = await client
    .from('sheet_share_access')
    .select('viewer_profile_id')
    .eq('target_kind', targetKind)
    .eq('target_id', targetId)

  if (error) {
    throw error
  }

  return [...new Set(((data ?? []) as SheetShareAccessRow[]).map((entry) => entry.viewer_profile_id))]
}

export async function updateSheetShareAccess(target: Profile, viewerIds: string[]) {
  const client = ensureSupabase()
  const { targetKind, targetId } = resolveShareTarget(target)
  const normalizedViewerIds = [...new Set(viewerIds)]
    .filter(Boolean)
    .filter((viewerId) => targetKind === 'npc' || viewerId !== targetId)

  const { error: deleteError } = await client
    .from('sheet_share_access')
    .delete()
    .eq('target_kind', targetKind)
    .eq('target_id', targetId)

  if (deleteError) {
    throw deleteError
  }

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
  let refreshToken = 0
  const timeoutIds = new Set<ReturnType<typeof setTimeout>>()

  const clearScheduledRefreshes = () => {
    timeoutIds.forEach((timeoutId) => clearTimeout(timeoutId))
    timeoutIds.clear()
  }

  const scheduleRefresh = () => {
    refreshToken += 1
    const nextToken = refreshToken

    clearScheduledRefreshes()

    ;[0, 180, 650].forEach((delay) => {
      const timeoutId = setTimeout(() => {
        timeoutIds.delete(timeoutId)

        if (disposed || nextToken !== refreshToken) {
          return
        }

        void fetchLatest()
          .then((nextValue) => {
            if (!nextValue || disposed || nextToken !== refreshToken) {
              return
            }

            onChange(nextValue)
          })
          .catch(() => {})
      }, delay)

      timeoutIds.add(timeoutId)
    })
  }

  return {
    scheduleRefresh,
    dispose() {
      disposed = true
      refreshToken += 1
      clearScheduledRefreshes()
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
      () => {
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
        event: '*',
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
  const { data, error } = await client
    .from('gm_settings')
    .select('groups')
    .eq('profile_id', profileId)
    .maybeSingle()

  if (error) throw error
  if (!data) return []
  return (data.groups as ProfileGroup[]) ?? []
}

export async function saveGmGroups(profileId: string, groups: ProfileGroup[]): Promise<void> {
  const client = ensureSupabase()
  const { error } = await client
    .from('gm_settings')
    .upsert({ profile_id: profileId, groups, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' })

  if (error) throw error
}
