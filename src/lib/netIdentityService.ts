import type { NetEntityId } from '../components/net/world/netWorldTypes'
import type { NetIdentitySubject } from '../components/net/identity/netIdentityTypes'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

const NPC_NETWORK_IDENTITY_ENABLE_TIMEOUT_MS = 15_000

export type NetServerIdentityKind = 'player' | 'npc'
export type NetServerIdentityPlayability = 'playable' | 'non-playable'

export interface NetIdentityLink {
  readonly id: string
  readonly subject: NetIdentitySubject
  readonly entityId?: NetEntityId
  readonly ownerProfileId?: string
  readonly campaignId?: string
  readonly identityKind: NetServerIdentityKind
  readonly playability: NetServerIdentityPlayability
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NetActiveIdentitySelection {
  readonly profileId: string
  readonly identityLinkId: string
  readonly createdAt: string
  readonly updatedAt: string
}

export const NET_ACTIVE_IDENTITY_CHANGED_EVENT = 'net:active-identity-changed'

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || !value) {
    throw new Error(`Invalid NET identity response field: ${key}`)
  }
  return value
}

function optionalString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key]
  return typeof value === 'string' && value ? value : undefined
}

function subjectFromRow(row: Record<string, unknown>): NetIdentitySubject {
  const kind = requiredString(row, 'subject_kind')
  const id = requiredString(row, 'subject_id')

  switch (kind) {
    case 'profile-sheet':
      return { kind, profileId: id }
    case 'npc-card':
      return { kind, npcCardId: id }
    case 'character':
      return { kind, characterId: id }
    default:
      throw new Error('The server returned an unsupported NET identity subject.')
  }
}

function parseIdentityLink(value: unknown): NetIdentityLink {
  if (!isRecord(value)) throw new Error('Invalid NET identity link response.')

  const identityKind = requiredString(value, 'identity_kind')
  const playability = requiredString(value, 'playability')
  if (identityKind !== 'player' && identityKind !== 'npc') {
    throw new Error('Invalid NET identity kind returned by the server.')
  }
  if (playability !== 'playable' && playability !== 'non-playable') {
    throw new Error('Invalid NET identity playability returned by the server.')
  }

  const entityId = optionalString(value, 'entity_id')
  const ownerProfileId = optionalString(value, 'owner_profile_id')
  const campaignId = optionalString(value, 'campaign_id')

  return {
    id: requiredString(value, 'id'),
    subject: subjectFromRow(value),
    ...(entityId ? { entityId } : {}),
    ...(ownerProfileId ? { ownerProfileId } : {}),
    ...(campaignId ? { campaignId } : {}),
    identityKind,
    playability,
    createdAt: requiredString(value, 'created_at'),
    updatedAt: requiredString(value, 'updated_at'),
  }
}

function parseActiveSelection(value: unknown): NetActiveIdentitySelection {
  if (!isRecord(value)) throw new Error('Invalid active NET identity response.')

  return {
    profileId: requiredString(value, 'profile_id'),
    identityLinkId: requiredString(value, 'identity_link_id'),
    createdAt: requiredString(value, 'created_at'),
    updatedAt: requiredString(value, 'updated_at'),
  }
}

/** RLS returns only links visible to the authenticated actor. */
export async function fetchNetIdentityLinks(): Promise<readonly NetIdentityLink[]> {
  const { data, error } = await client()
    .from('net_identity_links')
    .select(
      'id, subject_kind, subject_id, entity_id, owner_profile_id, campaign_id, identity_kind, playability, created_at, updated_at',
    )
    .order('created_at', { ascending: true })

  if (error) throw new Error(`NET identity links could not be loaded: ${error.message}`)
  return ((data as unknown[] | null) ?? []).map(parseIdentityLink)
}

/**
 * Explicit GM-only provisioning for an NPC card that should participate in
 * network services. The server creates only an NPC/non-playable identity link;
 * it does not assign an OS or grant player control.
 */
export async function enableNetGmNpcNetworkIdentity(
  subject: Extract<NetIdentitySubject, { readonly kind: 'npc-card' }>,
): Promise<NetIdentityLink> {
  const abortController = new AbortController()
  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, NPC_NETWORK_IDENTITY_ENABLE_TIMEOUT_MS)
  let data: unknown
  let error: { readonly message?: string } | null | undefined
  try {
    const response = await client()
      .rpc('enable_net_gm_npc_network_identity', {
        requested_npc_card_id: subject.npcCardId,
      })
      .abortSignal(abortController.signal)
    data = response.data
    error = response.error
  } catch (requestError) {
    error = requestError instanceof Error ? requestError : { message: 'unknown request error' }
  } finally {
    window.clearTimeout(timeout)
  }

  if (timedOut) throw new Error('NPC network identity enabling timed out. Retry the explicit GM action.')
  if (error) throw new Error(`NPC network identity could not be enabled: ${error.message ?? 'unknown server error.'}`)
  return parseIdentityLink(Array.isArray(data) ? data[0] : data)
}

/** The active table's RLS exposes at most the authenticated profile's row. */
export async function fetchActiveNetIdentity(): Promise<NetActiveIdentitySelection | null> {
  const { data, error } = await client()
    .from('net_active_identities')
    .select('profile_id, identity_link_id, created_at, updated_at')
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Active NET identity could not be loaded: ${error.message}`)
  return data ? parseActiveSelection(data) : null
}

/**
 * Selection accepts no profile, owner, role, or playability claims. PostgreSQL
 * derives the actor from auth.uid() and verifies the requested link itself.
 */
export async function setActiveNetIdentity(
  identityLinkId: string,
): Promise<NetActiveIdentitySelection> {
  if (!identityLinkId.trim()) throw new Error('A NET identity link id is required.')

  const { data, error } = await client().rpc('set_net_active_identity', {
    requested_identity_link_id: identityLinkId,
  })

  if (error) throw new Error(`Active NET identity could not be changed: ${error.message}`)
  const response = Array.isArray(data) ? data[0] : data
  const selection = parseActiveSelection(response)
  window.dispatchEvent(new Event(NET_ACTIVE_IDENTITY_CHANGED_EVENT))
  return selection
}
