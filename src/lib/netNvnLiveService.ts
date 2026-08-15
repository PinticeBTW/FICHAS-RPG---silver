import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import {
  NET_NVN_LIVE_BYLINE_MAX_LENGTH,
  NET_NVN_LIVE_DIRECTORY_MAX_LIMIT,
  NET_NVN_LIVE_HEADLINE_MAX_LENGTH,
  NET_NVN_LIVE_LOCATION_MAX_LENGTH,
  NET_NVN_LIVE_SUMMARY_MAX_LENGTH,
  NET_NVN_LIVE_UPDATE_BODY_MAX_LENGTH,
  NET_NVN_LIVE_UPDATE_MAX_ITEMS,
  NetNvnLiveRequestError,
  netNvnIncidentLifecycleActions,
  netNvnIncidentStatuses,
  netNvnIncidentUpdateKinds,
  netNvnIncidentUpdateVerificationStatuses,
  netNvnIncidentVerificationStatuses,
  type NetNvnGmIncidentDetail,
  type NetNvnGmIncidentDirectoryRow,
  type NetNvnGmIncidentInput,
  type NetNvnGmIncidentUpdateInput,
  type NetNvnIncidentDirectoryFilter,
  type NetNvnIncidentLifecycleAction,
  type NetNvnIncidentStatus,
  type NetNvnIncidentUpdate,
  type NetNvnIncidentUpdateKind,
  type NetNvnIncidentUpdateVerificationStatus,
  type NetNvnIncidentVerificationStatus,
  type NetNvnLiveDesk,
  type NetNvnLiveIncident,
} from './netNvnLiveTypes'
import { netNvnCategories, type NetNvnCategory } from './netNvnTypes'

interface SupabaseRpcErrorLike {
  readonly code?: string
  readonly message: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function client() {
  if (!supabase) throw new NetNvnLiveRequestError('request-failed', SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalidResponse(message: string): never {
  throw new NetNvnLiveRequestError('invalid-server-response', message)
}

function requiredString(value: unknown, maximumLength: number, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength) {
    return invalidResponse(`Invalid ${label} returned by the NVN live server.`)
  }
  return value
}

function optionalString(value: unknown, maximumLength: number, label: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return requiredString(value, maximumLength, label)
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    return invalidResponse(`Invalid ${label} returned by the NVN live server.`)
  }
  return value as Values[number]
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (Number.isNaN(Date.parse(parsed))) {
    return invalidResponse(`Invalid ${label} returned by the NVN live server.`)
  }
  return parsed
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return timestamp(value, label)
}

function uuid(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (!UUID_PATTERN.test(parsed)) {
    return invalidResponse(`Invalid ${label} returned by the NVN live server.`)
  }
  return parsed
}

function nonnegativeInteger(value: unknown, maximum: number, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    return invalidResponse(`Invalid ${label} returned by the NVN live server.`)
  }
  return parsed
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return isRecord(candidate) ? candidate : null
}

function mapError(prefix: string, error: SupabaseRpcErrorLike): NetNvnLiveRequestError {
  if (error.message.includes('Authentication is required')) {
    return new NetNvnLiveRequestError(
      'authentication-required',
      'Sign in again to reach the NVN live desk.',
    )
  }
  if (
    error.code === '42501'
    || error.message.includes('authoritative GM')
    || error.message.includes('NVN newsroom')
  ) {
    return new NetNvnLiveRequestError(
      'permission-denied',
      'Authoritative GM access is required for NVN Live Control.',
    )
  }
  if (error.message.includes('NVN_LIVE_DESK_BUSY')) {
    return new NetNvnLiveRequestError(
      'live-desk-busy',
      'Another NVN incident is already live. Close it before starting this desk.',
    )
  }
  if (error.message.includes('NVN_LIVE_UPDATE_LIMIT_REACHED')) {
    return new NetNvnLiveRequestError(
      'update-limit',
      `This live desk has reached its ${NET_NVN_LIVE_UPDATE_MAX_ITEMS}-update limit.`,
    )
  }
  if (error.code === 'P0002' || error.message.includes('NVN_LIVE_INCIDENT_NOT_FOUND')) {
    return new NetNvnLiveRequestError(
      'incident-not-found',
      'This live incident is no longer available to the newsroom editor.',
    )
  }
  if (error.message.includes('NVN_LIVE_LIFECYCLE_INVALID')) {
    return new NetNvnLiveRequestError(
      'invalid-lifecycle',
      'The live-desk lifecycle changed before this action completed. Refresh and try again.',
    )
  }
  if (error.code === '22023' || error.message.includes('NVN_LIVE_')) {
    return new NetNvnLiveRequestError(
      'invalid-input',
      'One or more fields do not match the bounded NVN live contract.',
    )
  }
  return new NetNvnLiveRequestError('request-failed', `${prefix}: ${error.message}`)
}

function parseUpdate(value: unknown): NetNvnIncidentUpdate {
  if (!isRecord(value)) return invalidResponse('Invalid update row in the NVN live ledger.')
  const sequence = nonnegativeInteger(
    value.sequence,
    NET_NVN_LIVE_UPDATE_MAX_ITEMS,
    'update sequence',
  )
  if (sequence < 1) return invalidResponse('Invalid update sequence in the NVN live ledger.')
  return {
    id: uuid(value.id, 'update id'),
    sequence,
    updateKind: enumValue(
      value.update_kind,
      netNvnIncidentUpdateKinds,
      'update kind',
    ) as NetNvnIncidentUpdateKind,
    verificationStatus: enumValue(
      value.verification_status,
      netNvnIncidentUpdateVerificationStatuses,
      'update verification status',
    ) as NetNvnIncidentUpdateVerificationStatus,
    body: requiredString(value.body, NET_NVN_LIVE_UPDATE_BODY_MAX_LENGTH, 'update body'),
    publishedAt: timestamp(value.published_at, 'update publication time'),
  }
}

function parseUpdates(value: unknown): readonly NetNvnIncidentUpdate[] {
  if (!Array.isArray(value) || value.length > NET_NVN_LIVE_UPDATE_MAX_ITEMS) {
    return invalidResponse('The NVN live ledger exceeded its bounded response contract.')
  }
  const updates = value.map(parseUpdate).sort((left, right) => left.sequence - right.sequence)
  if (updates.some((update, index) => index > 0 && update.sequence <= updates[index - 1]!.sequence)) {
    return invalidResponse('The NVN live ledger returned duplicate or unordered sequences.')
  }
  return updates
}

function parsePlayerIncident(value: unknown): NetNvnLiveIncident {
  if (!isRecord(value)) return invalidResponse('Invalid active incident returned by the NVN server.')
  const summary = optionalString(value.summary, NET_NVN_LIVE_SUMMARY_MAX_LENGTH, 'incident summary')
  const bylineRole = optionalString(value.byline_role, NET_NVN_LIVE_BYLINE_MAX_LENGTH, 'byline role')
  const districtLabel = optionalString(
    value.district_label,
    NET_NVN_LIVE_LOCATION_MAX_LENGTH,
    'district',
  )
  const locationLabel = optionalString(
    value.location_label,
    NET_NVN_LIVE_LOCATION_MAX_LENGTH,
    'location',
  )
  const occurredAt = optionalTimestamp(value.occurred_at, 'incident occurrence time')
  return {
    id: uuid(value.id, 'incident id'),
    headline: requiredString(
      value.headline,
      NET_NVN_LIVE_HEADLINE_MAX_LENGTH,
      'incident headline',
    ),
    ...(summary ? { summary } : {}),
    category: enumValue(value.category, netNvnCategories, 'incident category') as NetNvnCategory,
    verificationStatus: enumValue(
      value.verification_status,
      netNvnIncidentVerificationStatuses,
      'incident verification status',
    ) as NetNvnIncidentVerificationStatus,
    bylineName: requiredString(value.byline_name, NET_NVN_LIVE_BYLINE_MAX_LENGTH, 'byline'),
    ...(bylineRole ? { bylineRole } : {}),
    ...(districtLabel ? { districtLabel } : {}),
    ...(locationLabel ? { locationLabel } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    startedAt: timestamp(value.started_at, 'live start time'),
    updatedAt: timestamp(value.updated_at, 'incident update time'),
  }
}

function parseDirectoryRow(value: unknown): NetNvnGmIncidentDirectoryRow {
  if (!isRecord(value)) return invalidResponse('Invalid incident directory row.')
  const status = enumValue(value.status, netNvnIncidentStatuses, 'incident status') as NetNvnIncidentStatus
  const startedAt = optionalTimestamp(value.started_at, 'live start time')
  const closedAt = optionalTimestamp(value.closed_at, 'live close time')
  const archivedAt = optionalTimestamp(value.archived_at, 'incident archive time')
  return {
    id: uuid(value.id, 'incident id'),
    status,
    headline: requiredString(value.headline, NET_NVN_LIVE_HEADLINE_MAX_LENGTH, 'incident headline'),
    category: enumValue(value.category, netNvnCategories, 'incident category') as NetNvnCategory,
    verificationStatus: enumValue(
      value.verification_status,
      netNvnIncidentVerificationStatuses,
      'incident verification status',
    ) as NetNvnIncidentVerificationStatus,
    bylineName: requiredString(value.byline_name, NET_NVN_LIVE_BYLINE_MAX_LENGTH, 'byline'),
    updatedAt: timestamp(value.updated_at, 'incident update time'),
    ...(startedAt ? { startedAt } : {}),
    ...(closedAt ? { closedAt } : {}),
    ...(archivedAt ? { archivedAt } : {}),
    updateCount: nonnegativeInteger(value.update_count, NET_NVN_LIVE_UPDATE_MAX_ITEMS, 'update count'),
  }
}

function parseGmDetail(value: unknown): NetNvnGmIncidentDetail {
  if (!isRecord(value)) return invalidResponse('Invalid incident detail returned by the NVN editor server.')
  const status = enumValue(value.status, netNvnIncidentStatuses, 'incident status') as NetNvnIncidentStatus
  const playerFields = parsePlayerIncident({
    ...value,
    started_at: value.started_at ?? value.created_at,
  })
  const startedAt = optionalTimestamp(value.started_at, 'live start time')
  const closedAt = optionalTimestamp(value.closed_at, 'live close time')
  const archivedAt = optionalTimestamp(value.archived_at, 'incident archive time')
  const lifecycleIsValid =
    (status === 'draft' && !startedAt && !closedAt && !archivedAt)
    || (status === 'live' && Boolean(startedAt) && !closedAt && !archivedAt)
    || (status === 'closed' && Boolean(startedAt) && Boolean(closedAt) && !archivedAt)
    || (status === 'archived' && Boolean(startedAt) && Boolean(closedAt) && Boolean(archivedAt))
  if (!lifecycleIsValid) {
    return invalidResponse('Inconsistent incident lifecycle returned by the NVN editor server.')
  }
  return {
    id: playerFields.id,
    status,
    headline: playerFields.headline,
    ...(playerFields.summary ? { summary: playerFields.summary } : {}),
    category: playerFields.category,
    verificationStatus: playerFields.verificationStatus,
    bylineName: playerFields.bylineName,
    ...(playerFields.bylineRole ? { bylineRole: playerFields.bylineRole } : {}),
    ...(playerFields.districtLabel ? { districtLabel: playerFields.districtLabel } : {}),
    ...(playerFields.locationLabel ? { locationLabel: playerFields.locationLabel } : {}),
    ...(playerFields.occurredAt ? { occurredAt: playerFields.occurredAt } : {}),
    createdAt: timestamp(value.created_at, 'incident creation time'),
    updatedAt: timestamp(value.updated_at, 'incident update time'),
    ...(startedAt ? { startedAt } : {}),
    ...(closedAt ? { closedAt } : {}),
    ...(archivedAt ? { archivedAt } : {}),
    updates: parseUpdates(value.updates),
  }
}

function incidentArguments(input: NetNvnGmIncidentInput) {
  return {
    requested_headline: input.headline,
    requested_summary: input.summary ?? null,
    requested_category: input.category,
    requested_verification_status: input.verificationStatus,
    requested_byline_name: input.bylineName,
    requested_byline_role: input.bylineRole ?? null,
    requested_district_label: input.districtLabel ?? null,
    requested_location_label: input.locationLabel ?? null,
    requested_occurred_at: input.occurredAt ?? null,
  }
}

function assertIncidentId(incidentId: string) {
  if (!UUID_PATTERN.test(incidentId)) {
    throw new NetNvnLiveRequestError('invalid-input', 'The live incident reference is invalid.')
  }
}

export async function fetchNetNvnLiveDesk(
  expectedIdentityLinkId: string,
): Promise<NetNvnLiveDesk> {
  if (!UUID_PATTERN.test(expectedIdentityLinkId)) {
    throw new NetNvnLiveRequestError('authentication-required', 'The NVN runtime identity is unavailable.')
  }
  const { data, error } = await client().rpc('fetch_net_nvn_live_desk', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
  })
  if (error) throw mapError('NVN live coverage could not be loaded', error)
  if (!isRecord(data)) return invalidResponse('The NVN live server returned an invalid payload.')
  const updates = parseUpdates(data.updates)
  if (data.incident === null) {
    if (updates.length > 0) return invalidResponse('Updates were returned without an active live desk.')
    return { incident: null, updates: [] }
  }
  return { incident: parsePlayerIncident(data.incident), updates }
}

export async function fetchNetNvnGmIncidentDirectory(
  status: NetNvnIncidentDirectoryFilter = 'all',
  limit = NET_NVN_LIVE_DIRECTORY_MAX_LIMIT,
): Promise<readonly NetNvnGmIncidentDirectoryRow[]> {
  if (status !== 'all' && !netNvnIncidentStatuses.includes(status)) {
    throw new NetNvnLiveRequestError('invalid-input', 'The incident directory filter is invalid.')
  }
  const boundedLimit = Math.min(
    Math.max(Number.isFinite(limit) ? Math.trunc(limit) : NET_NVN_LIVE_DIRECTORY_MAX_LIMIT, 1),
    NET_NVN_LIVE_DIRECTORY_MAX_LIMIT,
  )
  const { data, error } = await client().rpc('fetch_net_nvn_gm_incident_directory', {
    requested_status: status,
    requested_limit: boundedLimit,
  })
  if (error) throw mapError('NVN live incident directory could not be loaded', error)
  if (!Array.isArray(data) || data.length > NET_NVN_LIVE_DIRECTORY_MAX_LIMIT) {
    return invalidResponse('The live incident directory exceeded its bounded response contract.')
  }
  return data.map(parseDirectoryRow)
}

export async function fetchNetNvnGmIncident(
  incidentId: string,
): Promise<NetNvnGmIncidentDetail | null> {
  assertIncidentId(incidentId)
  const { data, error } = await client().rpc('fetch_net_nvn_gm_incident', {
    requested_incident_id: incidentId,
  })
  if (error) throw mapError('NVN live incident could not be loaded for editing', error)
  const row = firstRow(data)
  return row ? parseGmDetail(row) : null
}

export async function createNetNvnGmIncident(
  input: NetNvnGmIncidentInput,
): Promise<NetNvnGmIncidentDetail> {
  const { data, error } = await client().rpc('create_net_nvn_gm_incident', incidentArguments(input))
  if (error) throw mapError('NVN live incident draft could not be created', error)
  const row = firstRow(data)
  return row ? parseGmDetail(row) : invalidResponse('Incident creation returned no record.')
}

export async function updateNetNvnGmIncident(
  incidentId: string,
  input: NetNvnGmIncidentInput,
): Promise<NetNvnGmIncidentDetail> {
  assertIncidentId(incidentId)
  const { data, error } = await client().rpc('update_net_nvn_gm_incident', {
    requested_incident_id: incidentId,
    ...incidentArguments(input),
  })
  if (error) throw mapError('NVN live incident could not be updated', error)
  const row = firstRow(data)
  return row ? parseGmDetail(row) : invalidResponse('Incident update returned no record.')
}

export async function setNetNvnGmIncidentLifecycle(
  incidentId: string,
  action: NetNvnIncidentLifecycleAction,
): Promise<NetNvnGmIncidentDetail> {
  assertIncidentId(incidentId)
  if (!netNvnIncidentLifecycleActions.includes(action)) {
    throw new NetNvnLiveRequestError('invalid-input', 'The live lifecycle request is invalid.')
  }
  const { data, error } = await client().rpc('set_net_nvn_gm_incident_lifecycle', {
    requested_incident_id: incidentId,
    requested_action: action,
  })
  if (error) throw mapError('NVN live lifecycle could not be changed', error)
  const row = firstRow(data)
  return row ? parseGmDetail(row) : invalidResponse('Lifecycle change returned no incident.')
}

export async function appendNetNvnGmIncidentUpdate(
  incidentId: string,
  input: NetNvnGmIncidentUpdateInput,
): Promise<NetNvnGmIncidentDetail> {
  assertIncidentId(incidentId)
  const { data, error } = await client().rpc('append_net_nvn_gm_incident_update', {
    requested_incident_id: incidentId,
    requested_update_kind: input.updateKind,
    requested_verification_status: input.verificationStatus,
    requested_body: input.body,
  })
  if (error) throw mapError('NVN live update could not be appended', error)
  const row = firstRow(data)
  return row ? parseGmDetail(row) : invalidResponse('Update append returned no incident.')
}
