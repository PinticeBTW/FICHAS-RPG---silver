import type { Profile, WebSheetRecord } from '../types/domain'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
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
  field_data: Record<string, unknown> | null
  updated_at: string | null
}

function ensureSupabase() {
  if (!supabase) {
    throw new Error(SUPABASE_CONFIG_ERROR)
  }

  return supabase
}

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    handle: row.handle,
    role: row.role,
    avatarUrl: row.avatar_url ?? undefined,
  }
}

function buildInitialFieldData() {
  return Object.fromEntries(pdfSheetTemplateFields.map((field) => [field.name, '']))
}

const EXTRA_FIELD_KEYS = [
  'FOTO',
  'FOTO2',
  'GM_NOTES',
  'GM_NOTE_PAGES',
  'GM_REMINDERS',
]

function mapSheet(row: SheetRow): WebSheetRecord {
  const nextFieldData: Record<string, string> = {}

  for (const field of pdfSheetTemplateFields) {
    const value = row.field_data?.[field.name]
    nextFieldData[field.name] = typeof value === 'string' ? value : ''
  }

  for (const key of EXTRA_FIELD_KEYS) {
    const value = row.field_data?.[key]
    nextFieldData[key] = typeof value === 'string' ? value : ''
  }

  return {
    id: row.id,
    profileId: row.profile_id,
    templateKey: row.template_key,
    fieldData: nextFieldData,
    updatedAt: row.updated_at ?? new Date().toISOString(),
  }
}

export const NPC_EMAIL_PREFIX = 'npc:'

export function isNpcProfile(profile: Profile) {
  return profile.email.startsWith(NPC_EMAIL_PREFIX)
}

type NpcCardRow = { id: string; display_name: string; field_data: Record<string, unknown> | null; updated_at: string | null }

function mapNpcProfile(row: NpcCardRow): Profile {
  return {
    id: row.id,
    email: `${NPC_EMAIL_PREFIX}${row.id}`,
    displayName: row.display_name,
    handle: row.id,
    role: 'player',
  }
}

function mapNpcSheet(row: NpcCardRow): WebSheetRecord {
  const nextFieldData: Record<string, string> = {}
  for (const field of pdfSheetTemplateFields) {
    const value = row.field_data?.[field.name]
    nextFieldData[field.name] = typeof value === 'string' ? value : ''
  }
  for (const key of EXTRA_FIELD_KEYS) {
    const value = row.field_data?.[key]
    nextFieldData[key] = typeof value === 'string' ? value : ''
  }
  return {
    id: row.id,
    profileId: row.id,
    templateKey: CURRENT_TEMPLATE_KEY,
    fieldData: nextFieldData,
    updatedAt: row.updated_at ?? new Date().toISOString(),
  }
}

export async function listSheetProfiles() {
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

  const profiles = ((profilesResult.data ?? []) as ProfileRow[]).map(mapProfile)
  const npcs = ((npcsResult.data ?? []) as NpcCardRow[]).map(mapNpcProfile)

  return [...profiles, ...npcs]
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

  const { error } = await client
    .from('profiles')
    .update({ display_name: trimmed })
    .eq('id', profileId)

  if (error) {
    throw error
  }
}

export async function updateNpcCardDisplayName(npcId: string, displayName: string): Promise<void> {
  const client = ensureSupabase()
  const trimmed = displayName.trim()

  if (!trimmed) {
    return
  }

  const { error } = await client
    .from('npc_cards')
    .update({ display_name: trimmed, updated_at: new Date().toISOString() })
    .eq('id', npcId)

  if (error) {
    throw error
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
  const { data, error } = await client
    .from('npc_cards')
    .update({ field_data: fieldData, updated_at: new Date().toISOString() })
    .eq('id', npcId)
    .select('id, display_name, field_data, updated_at')
    .single()

  if (error) throw error
  return mapNpcSheet(data as NpcCardRow)
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
      const resetFieldData = buildInitialFieldData()
      const { data: migrated, error: migrationError } = await client
        .from('character_sheet_forms')
        .update({
          template_key: CURRENT_TEMPLATE_KEY,
          field_data: resetFieldData,
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
  const { data, error } = await client
    .from('character_sheet_forms')
    .upsert(
      {
        profile_id: profileId,
        template_key: CURRENT_TEMPLATE_KEY,
        field_data: fieldData,
      },
      { onConflict: 'profile_id' },
    )
    .select('id, profile_id, template_key, field_data, updated_at')
    .single()

  if (error) {
    throw error
  }

  return mapSheet(data as SheetRow)
}

export function subscribeToSheet(
  profileId: string,
  onChange: (sheet: WebSheetRecord) => void,
) {
  const client = ensureSupabase()
  const channelId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  const channel = client
    .channel(`character-sheet-form:${profileId}:${Date.now()}:${channelId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'character_sheet_forms',
        filter: `profile_id=eq.${profileId}`,
      },
      (payload) => {
        if (payload.eventType === 'DELETE' || !payload.new) {
          return
        }

        onChange(mapSheet(payload.new as SheetRow))
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
