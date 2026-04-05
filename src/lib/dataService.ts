import type {
  AbilityItem,
  CampaignBundle,
  Character,
  CharacterNotes,
  CharacterStats,
  CyberwareItem,
  EditableCollectionKey,
  InventoryItem,
  Profile,
  SkillItem,
} from '../types/domain'
import { alignmentFromKarma, createActivityDetail } from './utils'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

type CollectionItem = SkillItem | AbilityItem | InventoryItem | CyberwareItem
type LiveProfileRow = {
  id: string
  email: string | null
  display_name: string | null
  displayName?: string | null
  handle: string | null
  role: Profile['role']
  avatar_url: string | null
  avatarUrl?: string | null
  active_campaign_id?: string | null
  activeCampaignId?: string | null
}

type LiveStatsRow = {
  hp_current: number
  hp_max: number
  ram_current: number
  ram_max: number
  karma: number
  cyberpsychosis: number
  humanity: number
  armor: number
  initiative: number
  reflex: number
  tech: number
  cool: number
  body: number
  intelligence: number
  empathy: number
  luck: number
}

type LiveSkillRow = {
  id: string
  name: string
  category: string
  rating: number
  notes: string | null
}

type LiveAbilityRow = {
  id: string
  name: string
  cost: string | null
  effect: string | null
  source: string | null
  notes: string | null
}

type LiveInventoryRow = {
  id: string
  name: string
  category: string | null
  quantity: number | null
  equipped: boolean | null
  notes: string | null
}

type LiveCyberwareRow = {
  id: string
  slot: string
  name: string
  tier: string | null
  effect: string | null
  cost: string | null
  notes: string | null
  stability: number | null
}

type LiveNotesRow = {
  player_journal: string | null
  gm_intel: string | null
  mission_log: string | null
}

type LiveCharacterRow = {
  id: string
  campaign_id: string
  owner_profile_id: string
  name: string
  alias: string
  archetype: string
  biography: string | null
  portrait_url: string | null
  status_label: string | null
  alignment: Character['alignment'] | null
  allow_player_stat_edits: boolean | null
  updated_at: string | null
  owner: LiveProfileRow | LiveProfileRow[] | null
  stats: LiveStatsRow | LiveStatsRow[] | null
  skills: LiveSkillRow[] | null
  abilities: LiveAbilityRow[] | null
  inventory: LiveInventoryRow[] | null
  cyberware: LiveCyberwareRow[] | null
  notes: LiveNotesRow | LiveNotesRow[] | null
}

type CampaignRow = {
  id: string
  name: string
  code_name: string
  description: string | null
  timeline: string | null
  season: string | null
}

type MembershipRow = {
  campaign_id: string
  role: Profile['role']
  campaign: CampaignRow | CampaignRow[] | null
}

type CampaignMemberRow = {
  profile: LiveProfileRow | LiveProfileRow[] | null
}

const characterSelect = `
  id,
  campaign_id,
  owner_profile_id,
  name,
  alias,
  archetype,
  biography,
  portrait_url,
  status_label,
  alignment,
  allow_player_stat_edits,
  updated_at,
  owner:profiles!characters_owner_profile_id_fkey (
    id,
    email,
    display_name,
    handle,
    role,
    avatar_url
  ),
  stats:character_stats (
    hp_current,
    hp_max,
    ram_current,
    ram_max,
    karma,
    cyberpsychosis,
    humanity,
    armor,
    initiative,
    reflex,
    tech,
    cool,
    body,
    intelligence,
    empathy,
    luck
  ),
  skills:character_skills (
    id,
    name,
    category,
    rating,
    notes
  ),
  abilities:character_abilities (
    id,
    name,
    cost,
    effect,
    source,
    notes
  ),
  inventory:character_inventory (
    id,
    name,
    category,
    quantity,
    equipped,
    notes
  ),
  cyberware:character_cyberware (
    id,
    slot,
    name,
    tier,
    effect,
    cost,
    notes,
    stability
  ),
  notes:character_notes (
    player_journal,
    gm_intel,
    mission_log
  )
`

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null
  }

  return Array.isArray(value) ? value[0] ?? null : value
}

function mapProfile(row: LiveProfileRow): Profile {
  return {
    id: row.id,
    email: row.email ?? '',
    displayName: row.display_name ?? row.displayName ?? 'Operativo',
    handle: row.handle ?? '@runner',
    role: row.role,
    avatarUrl: row.avatar_url ?? row.avatarUrl ?? undefined,
    activeCampaignId: row.active_campaign_id ?? row.activeCampaignId ?? undefined,
  }
}

function mapCharacter(row: LiveCharacterRow): Character {
  const stats = unwrapOne(row.stats)
  const notes = unwrapOne(row.notes)
  const owner = unwrapOne(row.owner)
  const ownerProfile = owner ? mapProfile(owner) : null

  return {
    id: row.id,
    campaignId: row.campaign_id,
    ownerProfileId: row.owner_profile_id,
    ownerName: ownerProfile?.displayName ?? 'Desconhecido',
    ownerHandle: ownerProfile?.handle ?? '@unknown',
    name: row.name,
    alias: row.alias,
    archetype: row.archetype,
    biography: row.biography ?? '',
    portraitUrl: row.portrait_url ?? '',
    statusLabel: row.status_label ?? 'A aguardar atualizacao',
    alignment: row.alignment ?? alignmentFromKarma(stats?.karma ?? 0),
    allowPlayerStatEdits: row.allow_player_stat_edits ?? false,
    updatedAt: row.updated_at ?? new Date().toISOString(),
    stats: {
      hpCurrent: stats?.hp_current ?? 0,
      hpMax: stats?.hp_max ?? 0,
      ramCurrent: stats?.ram_current ?? 0,
      ramMax: stats?.ram_max ?? 0,
      karma: stats?.karma ?? 0,
      cyberpsychosis: stats?.cyberpsychosis ?? 0,
      humanity: stats?.humanity ?? 0,
      armor: stats?.armor ?? 0,
      initiative: stats?.initiative ?? 0,
      reflex: stats?.reflex ?? 0,
      tech: stats?.tech ?? 0,
      cool: stats?.cool ?? 0,
      body: stats?.body ?? 0,
      intelligence: stats?.intelligence ?? 0,
      empathy: stats?.empathy ?? 0,
      luck: stats?.luck ?? 0,
    },
    skills: (row.skills ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      rating: entry.rating,
      notes: entry.notes ?? '',
    })),
    abilities: (row.abilities ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      cost: entry.cost ?? '',
      effect: entry.effect ?? '',
      source: entry.source ?? '',
      notes: entry.notes ?? '',
    })),
    inventory: (row.inventory ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      category: entry.category ?? '',
      quantity: entry.quantity ?? 1,
      equipped: entry.equipped ?? false,
      notes: entry.notes ?? '',
    })),
    cyberware: (row.cyberware ?? []).map((entry) => ({
      id: entry.id,
      slot: entry.slot,
      name: entry.name,
      tier: entry.tier ?? '',
      effect: entry.effect ?? '',
      cost: entry.cost ?? '',
      notes: entry.notes ?? '',
      stability: entry.stability ?? 0,
    })),
    notes: {
      playerJournal: notes?.player_journal ?? '',
      gmIntel: notes?.gm_intel ?? '',
      missionLog: notes?.mission_log ?? '',
    },
  }
}

export async function fetchAuthProfile(userId: string) {
  if (!supabase) {
    return null
  }

  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()

  if (error) {
    throw error
  }

  return mapProfile(data)
}

export async function fetchCampaignBundle(profile: Profile): Promise<CampaignBundle> {
  if (!supabase) {
    throw new Error(SUPABASE_CONFIG_ERROR)
  }

  const membershipQuery = await supabase
    .from('campaign_members')
    .select(
      `
        campaign_id,
        role,
        campaign:campaigns (
          id,
          name,
          code_name,
          description,
          timeline,
          season
        )
      `,
    )
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (membershipQuery.error) {
    throw membershipQuery.error
  }

  if (!membershipQuery.data) {
    return {
      campaign: null,
      profiles: [profile],
      characters: [],
      activity: [],
    }
  }

  const campaignRow = membershipQuery.data as MembershipRow
  const campaign = unwrapOne(campaignRow.campaign)
  const isGm = profile.role === 'gm' || campaignRow.role === 'gm'
  const charactersQuery = supabase!
    .from('characters')
    .select(characterSelect)
    .eq('campaign_id', campaignRow.campaign_id)
    .order('updated_at', { ascending: false })

  if (!isGm) {
    charactersQuery.eq('owner_profile_id', profile.id)
  }

  const [{ data: characterRows, error: characterError }, { data: memberRows, error: memberError }] =
    await Promise.all([
      charactersQuery,
      supabase!
        .from('campaign_members')
        .select(
          `
            role,
            profile:profiles (
              id,
              email,
              display_name,
              handle,
              role,
              avatar_url
            )
          `,
        )
        .eq('campaign_id', campaignRow.campaign_id)
        .eq('status', 'active'),
    ])

  if (characterError) {
    throw characterError
  }

  if (memberError) {
    throw memberError
  }

  const characters = ((characterRows ?? []) as LiveCharacterRow[]).map(mapCharacter)

  return {
    campaign: {
      id: campaign?.id ?? campaignRow.campaign_id,
      name: campaign?.name ?? 'Campanha',
      codeName: campaign?.code_name ?? 'GRID',
      description: campaign?.description ?? '',
      timeline: campaign?.timeline ?? '',
      season: campaign?.season ?? '',
    },
    profiles: ((memberRows ?? []) as CampaignMemberRow[])
      .map((entry) => unwrapOne(entry.profile))
      .filter(Boolean)
      .map((entry) => mapProfile(entry as LiveProfileRow)),
    characters,
    activity: characters.slice(0, 8).map((character) =>
      createActivityDetail(
        `${character.alias} atualizada`,
        `${character.ownerName} mexeu em ${character.statusLabel.toLowerCase()}.`,
        character.alignment,
      ),
    ),
  }
}

export async function saveCharacterBasics(
  characterId: string,
  payload: Partial<
    Pick<
      Character,
      | 'name'
      | 'alias'
      | 'archetype'
      | 'biography'
      | 'portraitUrl'
      | 'statusLabel'
      | 'alignment'
      | 'allowPlayerStatEdits'
    >
  >,
) {
  if (!supabase) {
    throw new Error(SUPABASE_CONFIG_ERROR)
  }

  const { error } = await supabase
    .from('characters')
    .update({
      name: payload.name,
      alias: payload.alias,
      archetype: payload.archetype,
      biography: payload.biography,
      portrait_url: payload.portraitUrl,
      status_label: payload.statusLabel,
      alignment: payload.alignment,
      allow_player_stat_edits: payload.allowPlayerStatEdits,
    })
    .eq('id', characterId)

  if (error) {
    throw error
  }
}

export async function saveCharacterStats(characterId: string, payload: CharacterStats) {
  if (!supabase) {
    throw new Error(SUPABASE_CONFIG_ERROR)
  }

  const { error } = await supabase.from('character_stats').upsert(
    {
      character_id: characterId,
      hp_current: payload.hpCurrent,
      hp_max: payload.hpMax,
      ram_current: payload.ramCurrent,
      ram_max: payload.ramMax,
      karma: payload.karma,
      cyberpsychosis: payload.cyberpsychosis,
      humanity: payload.humanity,
      armor: payload.armor,
      initiative: payload.initiative,
      reflex: payload.reflex,
      tech: payload.tech,
      cool: payload.cool,
      body: payload.body,
      intelligence: payload.intelligence,
      empathy: payload.empathy,
      luck: payload.luck,
    },
    { onConflict: 'character_id' },
  )

  if (error) {
    throw error
  }
}

export async function saveCharacterNotes(characterId: string, payload: CharacterNotes) {
  if (!supabase) {
    throw new Error(SUPABASE_CONFIG_ERROR)
  }

  const { error } = await supabase.from('character_notes').upsert(
    {
      character_id: characterId,
      player_journal: payload.playerJournal,
      gm_intel: payload.gmIntel,
      mission_log: payload.missionLog,
    },
    { onConflict: 'character_id' },
  )

  if (error) {
    throw error
  }
}

export async function saveCollectionItem(
  kind: EditableCollectionKey,
  characterId: string,
  payload: CollectionItem,
) {
  if (!supabase) {
    throw new Error(SUPABASE_CONFIG_ERROR)
  }

  const tableMap = {
    skills: 'character_skills',
    abilities: 'character_abilities',
    inventory: 'character_inventory',
    cyberware: 'character_cyberware',
  } as const

  let basePayload: Record<string, unknown>

  switch (kind) {
    case 'skills': {
      const entry = payload as SkillItem
      basePayload = {
        id: entry.id,
        character_id: characterId,
        name: entry.name,
        category: entry.category,
        rating: entry.rating,
        notes: entry.notes,
      }
      break
    }
    case 'abilities': {
      const entry = payload as AbilityItem
      basePayload = {
        id: entry.id,
        character_id: characterId,
        name: entry.name,
        cost: entry.cost,
        effect: entry.effect,
        source: entry.source,
        notes: entry.notes,
      }
      break
    }
    case 'inventory': {
      const entry = payload as InventoryItem
      basePayload = {
        id: entry.id,
        character_id: characterId,
        name: entry.name,
        category: entry.category,
        quantity: entry.quantity,
        equipped: entry.equipped,
        notes: entry.notes,
      }
      break
    }
    case 'cyberware': {
      const entry = payload as CyberwareItem
      basePayload = {
        id: entry.id,
        character_id: characterId,
        slot: entry.slot,
        name: entry.name,
        tier: entry.tier,
        effect: entry.effect,
        cost: entry.cost,
        notes: entry.notes,
        stability: entry.stability,
      }
      break
    }
  }

  const { error } = await supabase.from(tableMap[kind]).upsert(basePayload)

  if (error) {
    throw error
  }
}

export async function deleteCollectionItem(
  kind: EditableCollectionKey,
  _characterId: string,
  itemId: string,
) {
  if (!supabase) {
    throw new Error(SUPABASE_CONFIG_ERROR)
  }

  const tableMap = {
    skills: 'character_skills',
    abilities: 'character_abilities',
    inventory: 'character_inventory',
    cyberware: 'character_cyberware',
  } as const

  const { error } = await supabase.from(tableMap[kind]).delete().eq('id', itemId)

  if (error) {
    throw error
  }
}
