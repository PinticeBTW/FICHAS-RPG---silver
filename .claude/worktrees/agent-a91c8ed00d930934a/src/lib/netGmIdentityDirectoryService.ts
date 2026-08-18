import type { NetIdentityLink } from './netIdentityService'
import type {
  NetIdentitySubject,
  NetPlayableIdentityCandidate,
} from '../components/net/identity/netIdentityTypes'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import { resolveSharedMediaUrls } from './media/mediaStorage'
import { isSharedMediaReference } from './media/mediaReference'

// Matches the previous two 500-row source caps while keeping one scalar RPC.
const DIRECTORY_LIMIT = 1_000
const DIRECTORY_CACHE_TTL_MS = 60_000
const DETAIL_CACHE_TTL_MS = 2 * 60_000

interface CacheEntry<T> {
  readonly value: T
  readonly cachedAt: number
}

export interface NetGmIdentityDetail {
  readonly subject: Exclude<NetIdentitySubject, { readonly kind: 'character' }>
  readonly age?: string
  readonly gender?: string
  readonly occupation?: string
  readonly city?: string
  readonly sourceUpdatedAt?: string
}

const directoryCache = new Map<string, CacheEntry<readonly NetPlayableIdentityCandidate[]>>()
const directoryInflight = new Map<string, Promise<readonly NetPlayableIdentityCandidate[]>>()
const detailCache = new Map<string, CacheEntry<NetGmIdentityDetail>>()
const detailInflight = new Map<string, Promise<NetGmIdentityDetail>>()
const scopeEpoch = new Map<string, number>()

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
    throw new Error(`Invalid GM identity directory field: ${key}`)
  }
  return value
}

function optionalString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key]
  return typeof value === 'string' && value ? value : undefined
}

function subjectFromRow(
  row: Record<string, unknown>,
): Exclude<NetIdentitySubject, { readonly kind: 'character' }> {
  const subjectKind = requiredString(row, 'subject_kind')
  const subjectId = requiredString(row, 'subject_id')
  if (subjectKind === 'profile-sheet') return { kind: subjectKind, profileId: subjectId }
  if (subjectKind === 'npc-card') return { kind: subjectKind, npcCardId: subjectId }
  throw new Error('The GM identity directory returned an unsupported subject.')
}

function parseDirectoryCandidate(value: unknown): NetPlayableIdentityCandidate {
  if (!isRecord(value)) throw new Error('Invalid GM identity directory response.')
  const subject = subjectFromRow(value)
  const linkId = optionalString(value, 'identity_link_id')
  const identityKindValue = optionalString(value, 'identity_kind')
  const linkPlayabilityValue = optionalString(value, 'playability')
  const linkCreatedAt = optionalString(value, 'link_created_at')
  const linkUpdatedAt = optionalString(value, 'link_updated_at')

  if (identityKindValue && identityKindValue !== 'player' && identityKindValue !== 'npc') {
    throw new Error('Invalid server identity classification in GM directory.')
  }
  if (
    linkPlayabilityValue
    && linkPlayabilityValue !== 'playable'
    && linkPlayabilityValue !== 'non-playable'
  ) {
    throw new Error('Invalid server playability in GM directory.')
  }
  const identityKind = identityKindValue === 'player' || identityKindValue === 'npc'
    ? identityKindValue
    : undefined
  const linkPlayability = linkPlayabilityValue === 'playable' || linkPlayabilityValue === 'non-playable'
    ? linkPlayabilityValue
    : undefined
  if (linkId && (!identityKind || !linkPlayability || !linkCreatedAt || !linkUpdatedAt)) {
    throw new Error('Incomplete authoritative identity link in GM directory.')
  }

  const ownerProfileId = optionalString(value, 'owner_profile_id')
  const linkOwnerProfileId = optionalString(value, 'link_owner_profile_id')
  const entityId = optionalString(value, 'entity_id')
  const campaignId = optionalString(value, 'campaign_id')
  const avatarUrl = optionalString(value, 'avatar_url')
  const occupation = optionalString(value, 'occupation')
  const city = optionalString(value, 'city')
  const ownerDisplayName = optionalString(value, 'owner_display_name')
  const ownerHandle = optionalString(value, 'owner_handle')
  const sourceUpdatedAt = optionalString(value, 'source_updated_at')

  return {
    subject,
    sourceKind: subject.kind,
    displayName: requiredString(value, 'display_name'),
    displayNameSource: 'sheet',
    summaryStatus: 'ready',
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(occupation ? { occupation } : {}),
    ...(city ? { city } : {}),
    ...(ownerProfileId ? { ownerProfileId } : {}),
    ...(ownerDisplayName ? { ownerDisplayName } : {}),
    ...(ownerHandle ? { ownerHandle } : {}),
    ...(campaignId ? { campaignId } : {}),
    accessKind: 'gm',
    playability: identityKind === 'player' && linkPlayability === 'playable'
      ? 'confirmed'
      : 'not-playable',
    ...(sourceUpdatedAt ? { summaryUpdatedAt: sourceUpdatedAt } : {}),
    gmCapabilities: {
      inspect: value.can_inspect === true,
      takeControl: value.can_take_control === true,
      actAs: value.can_act_as === true,
    },
    ...(linkId && identityKind && linkPlayability && linkCreatedAt && linkUpdatedAt
      ? {
          authoritativeLink: {
            id: linkId,
            identityKind,
            playability: linkPlayability,
            ...(entityId ? { entityId } : {}),
            ...(linkOwnerProfileId ? { ownerProfileId: linkOwnerProfileId } : {}),
            ...(campaignId ? { campaignId } : {}),
            createdAt: linkCreatedAt,
            updatedAt: linkUpdatedAt,
          },
        }
      : {}),
  }
}

function parseIdentityDetail(value: unknown): NetGmIdentityDetail {
  if (!isRecord(value)) throw new Error('Invalid GM identity detail response.')
  const subject = subjectFromRow(value)
  const age = optionalString(value, 'age')
  const gender = optionalString(value, 'gender')
  const occupation = optionalString(value, 'occupation')
  const city = optionalString(value, 'city')
  const sourceUpdatedAt = optionalString(value, 'source_updated_at')
  return {
    subject,
    ...(age ? { age } : {}),
    ...(gender ? { gender } : {}),
    ...(occupation ? { occupation } : {}),
    ...(city ? { city } : {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
  }
}

function fresh<T>(entry: CacheEntry<T> | undefined, ttl: number): entry is CacheEntry<T> {
  return Boolean(entry && Date.now() - entry.cachedAt <= ttl)
}

function detailKey(gmProfileId: string, subject: NetGmIdentityDetail['subject']): string {
  const subjectId = subject.kind === 'profile-sheet' ? subject.profileId : subject.npcCardId
  return `${gmProfileId}:${subject.kind}:${subjectId}`
}

/**
 * Auth-scoped, bounded directory read. The profile id is a cache scope only;
 * PostgreSQL derives authorization exclusively from auth.uid().
 */
export function fetchNetGmIdentityDirectory(
  gmProfileId: string,
  options: { readonly force?: boolean } = {},
): Promise<readonly NetPlayableIdentityCandidate[]> {
  const cached = directoryCache.get(gmProfileId)
  if (!options.force && fresh(cached, DIRECTORY_CACHE_TTL_MS)) {
    return Promise.resolve(cached.value)
  }

  const activeRequest = directoryInflight.get(gmProfileId)
  if (activeRequest) return activeRequest
  if (!scopeEpoch.has(gmProfileId)) scopeEpoch.set(gmProfileId, 0)
  const requestEpoch = scopeEpoch.get(gmProfileId) ?? 0

  const request = Promise.resolve(client().rpc('fetch_net_gm_identity_directory', {
    requested_limit: DIRECTORY_LIMIT,
  })).then(async ({ data, error }) => {
    if (error) throw new Error(`GM identity directory could not be loaded: ${error.message}`)
    const parsedCandidates = ((data as unknown[] | null) ?? []).map(parseDirectoryCandidate)
    const mediaReferences = parsedCandidates.map((candidate) => candidate.avatarUrl).filter(
      (value): value is string => Boolean(value && isSharedMediaReference(value)),
    )
    let resolved = new Map<string, string>()
    if (mediaReferences.length) {
      try {
        resolved = await resolveSharedMediaUrls(mediaReferences, 'thumbnail')
      } catch {
        // A temporary Storage failure must not discard the compact directory.
      }
    }
    const candidates = parsedCandidates.map((candidate) => {
      if (!candidate.avatarUrl || !isSharedMediaReference(candidate.avatarUrl)) return candidate
      const avatarUrl = resolved.get(candidate.avatarUrl)
      const { avatarUrl: _unresolved, ...withoutAvatar } = candidate
      return avatarUrl ? { ...withoutAvatar, avatarUrl } : withoutAvatar
    })
    if ((scopeEpoch.get(gmProfileId) ?? 0) === requestEpoch) {
      directoryCache.set(gmProfileId, { value: candidates, cachedAt: Date.now() })
    }
    return candidates
  }).finally(() => {
    if (directoryInflight.get(gmProfileId) === request) directoryInflight.delete(gmProfileId)
  })

  directoryInflight.set(gmProfileId, request)
  return request
}

/** Reads scalar detail fields for one selected subject; never a full JSON form. */
export function fetchNetGmIdentityDetail(
  gmProfileId: string,
  subject: NetGmIdentityDetail['subject'],
  options: { readonly force?: boolean } = {},
): Promise<NetGmIdentityDetail> {
  const key = detailKey(gmProfileId, subject)
  const cached = detailCache.get(key)
  if (!options.force && fresh(cached, DETAIL_CACHE_TTL_MS)) return Promise.resolve(cached.value)
  const activeRequest = detailInflight.get(key)
  if (activeRequest) return activeRequest
  if (!scopeEpoch.has(gmProfileId)) scopeEpoch.set(gmProfileId, 0)
  const requestEpoch = scopeEpoch.get(gmProfileId) ?? 0

  const requestedSubjectId = subject.kind === 'profile-sheet' ? subject.profileId : subject.npcCardId
  const request = Promise.resolve(client().rpc('fetch_net_gm_identity_detail', {
    requested_subject_kind: subject.kind,
    requested_subject_id: requestedSubjectId,
  })).then(({ data, error }) => {
    if (error) throw new Error(`Character detail could not be loaded: ${error.message}`)
    const row = Array.isArray(data) ? data[0] : data
    if (!row) throw new Error('This character detail is no longer available.')
    const detail = parseIdentityDetail(row)
    if ((scopeEpoch.get(gmProfileId) ?? 0) === requestEpoch) {
      detailCache.set(key, { value: detail, cachedAt: Date.now() })
    }
    return detail
  }).finally(() => {
    if (detailInflight.get(key) === request) detailInflight.delete(key)
  })

  detailInflight.set(key, request)
  return request
}

export function getNetIdentityLinkFromDirectoryCandidate(
  candidate: NetPlayableIdentityCandidate,
): NetIdentityLink | undefined {
  const link = candidate.authoritativeLink
  if (!link) return undefined
  return {
    id: link.id,
    subject: candidate.subject,
    ...(link.entityId ? { entityId: link.entityId } : {}),
    ...(link.ownerProfileId ? { ownerProfileId: link.ownerProfileId } : {}),
    ...(link.campaignId ? { campaignId: link.campaignId } : {}),
    identityKind: link.identityKind,
    playability: link.playability,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  }
}

export function clearNetGmIdentityDirectoryCache(gmProfileId?: string): void {
  if (!gmProfileId) {
    for (const profileId of scopeEpoch.keys()) {
      scopeEpoch.set(profileId, (scopeEpoch.get(profileId) ?? 0) + 1)
    }
    directoryCache.clear()
    detailCache.clear()
    directoryInflight.clear()
    detailInflight.clear()
    return
  }
  scopeEpoch.set(gmProfileId, (scopeEpoch.get(gmProfileId) ?? 0) + 1)
  directoryCache.delete(gmProfileId)
  directoryInflight.delete(gmProfileId)
  for (const key of detailCache.keys()) {
    if (key.startsWith(`${gmProfileId}:`)) detailCache.delete(key)
  }
  for (const key of detailInflight.keys()) {
    if (key.startsWith(`${gmProfileId}:`)) detailInflight.delete(key)
  }
}
