import type {
  NetIdentitySubject,
  NetResolvedIdentity,
} from '../components/net/identity/netIdentityTypes'
import { isNetOsId, type NetOsId } from './netOsTypes'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

export type NetSystemHackingMethod = 'roll' | 'credential'
export type NetSystemCredentialKind = 'pin' | 'password'

export interface NetSystemHackingGrantSummary {
  readonly targetIdentityLinkId: string
  readonly enabled: boolean
  readonly method: NetSystemHackingMethod
  readonly grantedByProfileId: string
  readonly createdAt: string
  readonly updatedAt: string
  /** True once the actor has requested a roll attempt against this exact target, awaiting Silver's confirmation. */
  readonly rollPending: boolean
  readonly rollRequestedAt?: string
}

export interface NetSystemHackingGrant extends NetSystemHackingGrantSummary {
  readonly actorIdentityLinkId: string
}

export interface NetSystemCredentialStatus {
  readonly identityLinkId: string
  readonly configured: boolean
  readonly credentialKind: NetSystemCredentialKind | null
  readonly updatedAt: string | null
}

export interface NetSystemHackingTarget {
  readonly targetIdentityLinkId: string
  readonly displayName: string
  readonly avatarUrl?: string
  readonly osId: NetOsId | null
  readonly method: NetSystemHackingMethod
}

export type NetSystemHackingSessionState =
  | { readonly active: false }
  | {
      readonly active: true
      readonly targetIdentityLinkId: string
      readonly targetOsId: NetOsId | null
      readonly establishedVia: NetSystemHackingMethod
      readonly createdAt: string
      readonly updatedAt: string
    }

/** The current actor's own pending ROLL attempt, if any -- server-authoritative, survives reload/remount. */
export type NetSystemHackingRollAttemptState =
  | { readonly pending: false }
  | { readonly pending: true; readonly targetIdentityLinkId: string; readonly requestedAt: string }

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
    throw new Error(`Invalid hacking grant field: ${key}`)
  }
  return value
}

function requiredBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key]
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid hacking grant field: ${key}`)
  }
  return value
}

function requiredMethod(row: Record<string, unknown>, key: string): NetSystemHackingMethod {
  const value = row[key]
  if (value !== 'roll' && value !== 'credential') {
    throw new Error(`Invalid hacking field: ${key}`)
  }
  return value
}

function optionalOsId(row: Record<string, unknown>, key: string): NetOsId | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (!isNetOsId(value)) throw new Error(`Invalid hacking field: ${key}`)
  return value
}

function parseGrantSummary(value: unknown): NetSystemHackingGrantSummary {
  if (!isRecord(value)) throw new Error('Invalid hacking grant response.')
  // roll_pending is absent from set/revoke responses (only the grants-list
  // RPC populates it) -- treated as false rather than required, since those
  // two mutation responses are always followed by a full grants refresh
  // wherever pending state actually matters.
  const rollPending = value.roll_pending === true
  const rollRequestedAt = value.roll_requested_at
  return {
    targetIdentityLinkId: requiredString(value, 'target_identity_link_id'),
    enabled: requiredBoolean(value, 'enabled'),
    method: requiredMethod(value, 'method'),
    grantedByProfileId: requiredString(value, 'granted_by_profile_id'),
    createdAt: requiredString(value, 'created_at'),
    updatedAt: requiredString(value, 'updated_at'),
    rollPending,
    ...(rollPending && typeof rollRequestedAt === 'string' ? { rollRequestedAt } : {}),
  }
}

function parseGrant(value: unknown): NetSystemHackingGrant {
  if (!isRecord(value)) throw new Error('Invalid hacking grant response.')
  return {
    ...parseGrantSummary(value),
    actorIdentityLinkId: requiredString(value, 'actor_identity_link_id'),
  }
}

function parseCredentialStatus(value: unknown): NetSystemCredentialStatus {
  if (!isRecord(value)) throw new Error('Invalid system security response.')
  const configured = requiredBoolean(value, 'configured')
  const kind = value.credential_kind
  if (configured && kind !== 'pin' && kind !== 'password') {
    throw new Error('Invalid system security field: credential_kind')
  }
  const updatedAt = value.updated_at
  return {
    identityLinkId: requiredString(value, 'identity_link_id'),
    configured,
    credentialKind: configured ? (kind as NetSystemCredentialKind) : null,
    updatedAt: configured && typeof updatedAt === 'string' ? updatedAt : null,
  }
}

function parseHackingTarget(value: unknown): NetSystemHackingTarget {
  if (!isRecord(value)) throw new Error('Invalid hacking target response.')
  const avatarUrl = value.avatar_url
  return {
    targetIdentityLinkId: requiredString(value, 'target_identity_link_id'),
    displayName: requiredString(value, 'display_name'),
    ...(typeof avatarUrl === 'string' && avatarUrl ? { avatarUrl } : {}),
    osId: optionalOsId(value, 'os_id'),
    method: requiredMethod(value, 'method'),
  }
}

function parseHackingSessionState(value: unknown): NetSystemHackingSessionState {
  if (!isRecord(value)) throw new Error('Invalid hacking session response.')
  if (!requiredBoolean(value, 'active')) return { active: false }
  return {
    active: true,
    targetIdentityLinkId: requiredString(value, 'target_identity_link_id'),
    targetOsId: optionalOsId(value, 'target_os_id'),
    establishedVia: requiredMethod(value, 'established_via'),
    createdAt: requiredString(value, 'created_at'),
    updatedAt: requiredString(value, 'updated_at'),
  }
}

function parseRollAttemptState(value: unknown): NetSystemHackingRollAttemptState {
  if (!isRecord(value)) throw new Error('Invalid roll attempt response.')
  if (!requiredBoolean(value, 'pending')) return { pending: false }
  return {
    pending: true,
    targetIdentityLinkId: requiredString(value, 'target_identity_link_id'),
    requestedAt: requiredString(value, 'requested_at'),
  }
}

/** GM System only -- persistent hacking grants authored FROM the given actor identity. */
export async function fetchNetSystemHackingGrants(
  actorIdentityLinkId: string,
): Promise<readonly NetSystemHackingGrantSummary[]> {
  const normalized = actorIdentityLinkId.trim()
  if (!normalized) throw new Error('An actor identity is required.')
  const { data, error } = await client().rpc('fetch_net_system_hacking_grants', {
    requested_actor_identity_link_id: normalized,
  })
  if (error) throw new Error(`Hacking grants could not be loaded: ${error.message}`)
  if (!Array.isArray(data)) throw new Error('Hacking grants response was invalid.')
  return data.map(parseGrantSummary)
}

/** GM System only -- create or update an actor -> target grant (always enabled). */
export async function setNetSystemHackingGrant(
  actorIdentityLinkId: string,
  targetIdentityLinkId: string,
  method: NetSystemHackingMethod,
): Promise<NetSystemHackingGrant> {
  const normalizedActor = actorIdentityLinkId.trim()
  const normalizedTarget = targetIdentityLinkId.trim()
  if (!normalizedActor || !normalizedTarget) throw new Error('An actor and target identity are required.')
  const { data, error } = await client().rpc('set_net_system_hacking_grant', {
    requested_actor_identity_link_id: normalizedActor,
    requested_target_identity_link_id: normalizedTarget,
    requested_method: method,
  })
  if (error) throw new Error(`The hacking grant could not be saved: ${error.message}`)
  return parseGrant(data)
}

/** GM System only -- disable an actor -> target grant. The row is retained, not deleted. */
export async function revokeNetSystemHackingGrant(
  actorIdentityLinkId: string,
  targetIdentityLinkId: string,
): Promise<NetSystemHackingGrant> {
  const normalizedActor = actorIdentityLinkId.trim()
  const normalizedTarget = targetIdentityLinkId.trim()
  if (!normalizedActor || !normalizedTarget) throw new Error('An actor and target identity are required.')
  const { data, error } = await client().rpc('revoke_net_system_hacking_grant', {
    requested_actor_identity_link_id: normalizedActor,
    requested_target_identity_link_id: normalizedTarget,
  })
  if (error) throw new Error(`The hacking grant could not be revoked: ${error.message}`)
  return parseGrant(data)
}

/**
 * GM System only -- confirm a successful roll-mode hack. No dice math here;
 * this only records a GM-authorised outcome. Returns void: the RPC's own
 * return value is the raw net_system_hacking_sessions row, which lacks the
 * joined target_os_id fetch_net_system_hacking_session() provides, so the
 * caller re-fetches that enriched state after this resolves rather than
 * risking a partially-populated session shape.
 */
export async function confirmNetSystemHackingRollSuccess(
  actorIdentityLinkId: string,
  targetIdentityLinkId: string,
): Promise<void> {
  const normalizedActor = actorIdentityLinkId.trim()
  const normalizedTarget = targetIdentityLinkId.trim()
  if (!normalizedActor || !normalizedTarget) throw new Error('An actor and target identity are required.')
  const { error } = await client().rpc('confirm_net_system_hacking_roll_success', {
    requested_actor_identity_link_id: normalizedActor,
    requested_target_identity_link_id: normalizedTarget,
  })
  if (error) throw new Error(`The roll could not be confirmed: ${error.message}`)
}

/**
 * GM System only -- marks the matching pending roll attempt failed. Creates
 * no session and never touches the persistent grant, so the actor can
 * immediately request another attempt against the same target.
 */
export async function failNetSystemHackingRollAttempt(
  actorIdentityLinkId: string,
  targetIdentityLinkId: string,
): Promise<void> {
  const normalizedActor = actorIdentityLinkId.trim()
  const normalizedTarget = targetIdentityLinkId.trim()
  if (!normalizedActor || !normalizedTarget) throw new Error('An actor and target identity are required.')
  const { error } = await client().rpc('fail_net_system_hacking_roll_attempt', {
    requested_actor_identity_link_id: normalizedActor,
    requested_target_identity_link_id: normalizedTarget,
  })
  if (error) throw new Error(`The roll attempt could not be marked failed: ${error.message}`)
}

/** Own effective runtime identity only -- never returns the credential/hash. */
export async function fetchNetSystemCredentialStatus(
  identityLinkId: string,
): Promise<NetSystemCredentialStatus> {
  const normalized = identityLinkId.trim()
  if (!normalized) throw new Error('A network identity is required.')
  const { data, error } = await client().rpc('fetch_net_system_credential_status', {
    requested_expected_identity_link_id: normalized,
  })
  if (error) throw new Error(`System security status could not be loaded: ${error.message}`)
  return parseCredentialStatus(data)
}

/** Own effective runtime identity only -- sets or changes the fictional OS credential. */
export async function setNetSystemCredential(
  identityLinkId: string,
  credentialKind: NetSystemCredentialKind,
  credential: string,
): Promise<NetSystemCredentialStatus> {
  const normalized = identityLinkId.trim()
  if (!normalized) throw new Error('A network identity is required.')
  const { data, error } = await client().rpc('set_net_system_credential', {
    requested_expected_identity_link_id: normalized,
    requested_credential_kind: credentialKind,
    requested_credential: credential,
  })
  if (error) throw new Error(`System security could not be changed: ${error.message}`)
  return parseCredentialStatus(data)
}

/** Own effective runtime identity only -- removes the fictional OS credential entirely. */
export async function clearNetSystemCredential(
  identityLinkId: string,
): Promise<NetSystemCredentialStatus> {
  const normalized = identityLinkId.trim()
  if (!normalized) throw new Error('A network identity is required.')
  const { data, error } = await client().rpc('clear_net_system_credential', {
    requested_expected_identity_link_id: normalized,
  })
  if (error) throw new Error(`System security could not be removed: ${error.message}`)
  return parseCredentialStatus(data)
}

/** Current effective runtime identity only -- enabled grants authorised TO this actor. No actor id is ever sent to the server. */
export async function fetchNetSystemHackingTargets(): Promise<readonly NetSystemHackingTarget[]> {
  const { data, error } = await client().rpc('fetch_net_system_hacking_targets')
  if (error) throw new Error(`Authorised systems could not be loaded: ${error.message}`)
  if (!Array.isArray(data)) throw new Error('Authorised systems response was invalid.')
  return data.map(parseHackingTarget)
}

/**
 * Current effective runtime identity only (never a client-supplied actor).
 * Signals a real, server-recorded ROLL attempt for Silver to see and
 * resolve -- the actor cannot decide success themselves. Requires an
 * enabled method='roll' grant for the exact target and no already-active
 * hacking session; requesting a different target while one is already
 * pending fails rather than silently switching.
 */
export async function requestNetSystemHackingRollAttempt(
  targetIdentityLinkId: string,
): Promise<NetSystemHackingRollAttemptState> {
  const normalized = targetIdentityLinkId.trim()
  if (!normalized) throw new Error('A target identity is required.')
  const { data, error } = await client().rpc('request_net_system_hacking_roll_attempt', {
    requested_target_identity_link_id: normalized,
  })
  if (error) throw new Error(`The roll request could not be sent: ${error.message}`)
  return parseRollAttemptState(data)
}

/** Current effective runtime identity only -- the actor's own pending roll attempt, if any. Used to restore "AWAITING GM ROLL CONFIRMATION" after reload/remount; never polled automatically. */
export async function fetchNetSystemHackingRollAttempt(): Promise<NetSystemHackingRollAttemptState> {
  const { data, error } = await client().rpc('fetch_net_system_hacking_roll_attempt')
  if (error) throw new Error(`Roll attempt status could not be loaded: ${error.message}`)
  return parseRollAttemptState(data)
}

/**
 * Current effective runtime identity only. Every failure path on the server
 * raises the identical generic exception, and this wrapper never passes
 * error.message through to the caller, so no server detail (wrong
 * credential, missing grant, target state) can leak into the UI. Returns
 * void for the same reason confirmNetSystemHackingRollSuccess does: the raw
 * session row this RPC returns lacks target_os_id, so the caller re-fetches
 * fetch_net_system_hacking_session() for the enriched state on success.
 */
export async function attemptNetSystemCredentialAccess(
  targetIdentityLinkId: string,
  credential: string,
): Promise<void> {
  const normalized = targetIdentityLinkId.trim()
  if (!normalized) throw new Error('ACCESS DENIED')
  const { error } = await client().rpc('attempt_net_system_credential_access', {
    requested_target_identity_link_id: normalized,
    requested_credential: credential,
  })
  if (error) throw new Error('ACCESS DENIED')
}

/** Current effective runtime identity only -- the actor's own active hacking session, if any. */
export async function fetchNetSystemHackingSession(): Promise<NetSystemHackingSessionState> {
  const { data, error } = await client().rpc('fetch_net_system_hacking_session')
  if (error) throw new Error(`Hacking session status could not be loaded: ${error.message}`)
  return parseHackingSessionState(data)
}

/** Voluntary self-disconnect. Never alters the persistent grant. Returns whether a session actually ended. */
export async function endNetSystemHackingSession(): Promise<boolean> {
  const { data, error } = await client().rpc('end_net_system_hacking_session')
  if (error) throw new Error(`The hacking session could not be ended: ${error.message}`)
  if (typeof data !== 'boolean') throw new Error('Invalid hacking session disconnect response.')
  return data
}

function parseHackingSubject(kind: unknown, id: unknown): NetIdentitySubject {
  if (typeof id !== 'string' || !id) throw new Error('Invalid hacking target subject id.')
  if (kind === 'profile-sheet') return { kind: 'profile-sheet', profileId: id }
  if (kind === 'npc-card') return { kind: 'npc-card', npcCardId: id }
  if (kind === 'character') return { kind: 'character', characterId: id }
  throw new Error('Invalid hacking target subject kind.')
}

/**
 * The same NetResolvedIdentity shape a normal player's own candidate
 * resolution produces, scoped to the actor's own active hacking target.
 * ownerProfileId is deliberately never returned by the server for this --
 * left undefined here, matching every other hacking-target presentation in
 * this file.
 */
export async function fetchNetSystemHackingTargetResolvedIdentity(): Promise<NetResolvedIdentity> {
  const { data, error } = await client().rpc('fetch_net_system_hacking_target_resolved_identity')
  if (error) throw new Error(`The compromised identity could not be resolved: ${error.message}`)
  if (!isRecord(data)) throw new Error('Invalid compromised identity response.')

  const identityLinkId = requiredString(data, 'identity_link_id')
  const subject = parseHackingSubject(data.subject_kind, data.subject_id)
  const identityKind = data.identity_kind
  if (identityKind !== 'player' && identityKind !== 'npc') {
    throw new Error('Invalid compromised identity field: identity_kind')
  }
  const displayName = requiredString(data, 'display_name')
  const avatarUrl = data.avatar_url
  const entityId = data.entity_id
  const campaignId = data.campaign_id

  return {
    subject,
    identityLinkId,
    identityKind,
    displayName,
    ...(typeof avatarUrl === 'string' && avatarUrl ? { avatarUrl } : {}),
    ...(typeof entityId === 'string' && entityId ? { worldEntityId: entityId } : {}),
    ...(typeof campaignId === 'string' && campaignId ? { campaignId } : {}),
    worldLinkStatus: typeof entityId === 'string' && entityId ? 'linked' : 'unlinked',
    authoringStatus: 'identity-ready',
  }
}
