import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import {
  NET_ECHO_BODY_MAX_LENGTH,
  NET_ECHO_GM_DIRECTORY_LIMIT,
  NET_ECHO_GM_GRANT_TARGET_LIMIT,
  NET_ECHO_GM_LINK_LIMIT,
  NET_ECHO_LOCKED_TEASER_MAX_LENGTH,
  NET_ECHO_SUMMARY_MAX_LENGTH,
  NET_ECHO_TITLE_MAX_LENGTH,
  NetEchoPrerequisiteRequiredError,
  netEchoIntensities,
  netEchoRelationshipKinds,
  netEchoReliabilities,
  netEchoSignalKinds,
  netEchoSignalStatuses,
  netEchoVisibilityModes,
  type NetEchoGmGrantResult,
  type NetEchoGmGrantTarget,
  type NetEchoGmSignalDetail,
  type NetEchoGmSignalDirectoryRow,
  type NetEchoGmSignalInput,
  type NetEchoGmSignalLink,
  type NetEchoIntensity,
  type NetEchoPrimaryReference,
  type NetEchoReliability,
  type NetEchoRelationshipKind,
  type NetEchoSignalKind,
  type NetEchoSignalStatus,
  type NetEchoVisibilityMode,
} from './netEchoTypes'

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`Invalid ${label} returned by the ECHO GM server.`)
  }
  return value
}

function optionalString(value: unknown, maximum: number, label: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return requiredString(value, maximum, label)
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`Invalid ${label} returned by the ECHO GM server.`)
  }
  return value as T[number]
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (Number.isNaN(Date.parse(parsed))) {
    throw new Error(`Invalid ${label} returned by the ECHO GM server.`)
  }
  return parsed
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return timestamp(value, label)
}

function numberInRange(value: unknown, minimum: number, maximum: number, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid ${label} returned by the ECHO GM server.`)
  }
  return parsed
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label} returned by the ECHO GM server.`)
  }
  return parsed
}

function parseFrequencies(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 10) {
    throw new Error('Invalid frequencies returned by the ECHO GM server.')
  }
  return value.map((frequency) => requiredString(frequency, 32, 'frequency'))
}

function mapError(prefix: string, message: string): Error {
  if (message.includes('ECHO_PREREQUISITE_REQUIRED')) {
    return new NetEchoPrerequisiteRequiredError()
  }
  return new Error(`${prefix}: ${message}`)
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.map((row) => {
    if (!isRecord(row)) throw new Error('Invalid ECHO GM collection response.')
    return row
  })
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return isRecord(candidate) ? candidate : null
}

function parseDirectoryRow(row: Record<string, unknown>): NetEchoGmSignalDirectoryRow {
  return {
    id: requiredString(row.signal_id, 64, 'signal id'),
    title: requiredString(row.title, NET_ECHO_TITLE_MAX_LENGTH, 'signal title'),
    kind: enumValue(row.kind, netEchoSignalKinds, 'signal kind') as NetEchoSignalKind,
    status: enumValue(row.status, netEchoSignalStatuses, 'signal status') as NetEchoSignalStatus,
    visibilityMode: enumValue(
      row.visibility_mode,
      netEchoVisibilityModes,
      'visibility mode',
    ) as NetEchoVisibilityMode,
    reliability: enumValue(
      row.reliability,
      netEchoReliabilities,
      'signal reliability',
    ) as NetEchoReliability,
    intensity: enumValue(
      row.intensity,
      netEchoIntensities,
      'signal intensity',
    ) as NetEchoIntensity,
    mapX: numberInRange(row.map_x, 0, 100, 'map x coordinate'),
    mapY: numberInRange(row.map_y, 0, 100, 'map y coordinate'),
    ...(optionalString(row.locked_teaser, NET_ECHO_LOCKED_TEASER_MAX_LENGTH, 'locked teaser')
      ? { lockedTeaser: optionalString(row.locked_teaser, NET_ECHO_LOCKED_TEASER_MAX_LENGTH, 'locked teaser') }
      : {}),
    linkCount: nonNegativeInteger(row.link_count, 'signal link count'),
    requiresCount: nonNegativeInteger(row.requires_count, 'signal prerequisite count'),
    updatedAt: timestamp(row.updated_at, 'signal update timestamp'),
    ...(optionalTimestamp(row.revealed_at, 'signal reveal timestamp')
      ? { revealedAt: optionalTimestamp(row.revealed_at, 'signal reveal timestamp') }
      : {}),
  }
}

function parseLink(row: Record<string, unknown>): NetEchoGmSignalLink {
  return {
    fromSignalId: requiredString(row.from_signal_id, 64, 'link source id'),
    toSignalId: requiredString(row.to_signal_id, 64, 'link target id'),
    relationshipKind: enumValue(
      row.relationship_kind,
      netEchoRelationshipKinds,
      'link relationship',
    ) as NetEchoRelationshipKind,
    ...(optionalString(row.label, 80, 'link label')
      ? { label: optionalString(row.label, 80, 'link label') }
      : {}),
    createdAt: timestamp(row.created_at, 'link creation timestamp'),
  }
}

function parsePrimaryReference(row: Record<string, unknown>): NetEchoPrimaryReference | undefined {
  const appId = optionalString(row.primary_reference_app_id, 32, 'reference app')
  const resourceKind = optionalString(row.primary_reference_resource_kind, 40, 'reference kind')
  const resourceId = optionalString(row.primary_reference_resource_id, 160, 'reference id')
  if (!appId && !resourceKind && !resourceId) return undefined
  if (!appId || !resourceKind || !resourceId) {
    throw new Error('Invalid cross-app reference returned by the ECHO GM server.')
  }
  return { appId, resourceKind, resourceId }
}

function parseSignalDetail(row: Record<string, unknown>): NetEchoGmSignalDetail {
  const links = row.links
  if (!Array.isArray(links) || links.length > NET_ECHO_GM_LINK_LIMIT) {
    throw new Error('ECHO signal links exceeded the bounded editor contract.')
  }
  const integrity = row.integrity_percent === null || row.integrity_percent === undefined
    ? undefined
    : numberInRange(row.integrity_percent, 0, 100, 'signal integrity')
  const primaryReference = parsePrimaryReference(row)
  return {
    id: requiredString(row.id, 64, 'signal id'),
    kind: enumValue(row.kind, netEchoSignalKinds, 'signal kind') as NetEchoSignalKind,
    status: enumValue(row.status, netEchoSignalStatuses, 'signal status') as NetEchoSignalStatus,
    visibilityMode: enumValue(
      row.visibility_mode,
      netEchoVisibilityModes,
      'visibility mode',
    ) as NetEchoVisibilityMode,
    title: requiredString(row.title, NET_ECHO_TITLE_MAX_LENGTH, 'signal title'),
    ...(optionalString(row.summary, NET_ECHO_SUMMARY_MAX_LENGTH, 'signal summary')
      ? { summary: optionalString(row.summary, NET_ECHO_SUMMARY_MAX_LENGTH, 'signal summary') }
      : {}),
    body: requiredString(row.body, NET_ECHO_BODY_MAX_LENGTH, 'signal body'),
    reliability: enumValue(
      row.reliability,
      netEchoReliabilities,
      'signal reliability',
    ) as NetEchoReliability,
    intensity: enumValue(
      row.intensity,
      netEchoIntensities,
      'signal intensity',
    ) as NetEchoIntensity,
    frequencies: parseFrequencies(row.frequencies),
    mapX: numberInRange(row.map_x, 0, 100, 'map x coordinate'),
    mapY: numberInRange(row.map_y, 0, 100, 'map y coordinate'),
    ...(integrity === undefined ? {} : { integrityPercent: integrity }),
    ...(optionalString(row.locked_teaser, NET_ECHO_LOCKED_TEASER_MAX_LENGTH, 'locked teaser')
      ? { lockedTeaser: optionalString(row.locked_teaser, NET_ECHO_LOCKED_TEASER_MAX_LENGTH, 'locked teaser') }
      : {}),
    ...(optionalString(row.source_account_id, 64, 'source account id')
      ? { sourceAccountId: optionalString(row.source_account_id, 64, 'source account id') }
      : {}),
    ...(optionalString(row.source_label, 120, 'source label')
      ? { sourceLabel: optionalString(row.source_label, 120, 'source label') }
      : {}),
    ...(optionalString(row.location_label, 120, 'location label')
      ? { locationLabel: optionalString(row.location_label, 120, 'location label') }
      : {}),
    ...(optionalString(row.district_label, 80, 'district label')
      ? { districtLabel: optionalString(row.district_label, 80, 'district label') }
      : {}),
    ...(optionalTimestamp(row.occurred_at, 'signal occurrence timestamp')
      ? { occurredAt: optionalTimestamp(row.occurred_at, 'signal occurrence timestamp') }
      : {}),
    ...(primaryReference ? { primaryReference } : {}),
    createdAt: timestamp(row.created_at, 'signal creation timestamp'),
    updatedAt: timestamp(row.updated_at, 'signal update timestamp'),
    ...(optionalTimestamp(row.revealed_at, 'signal reveal timestamp')
      ? { revealedAt: optionalTimestamp(row.revealed_at, 'signal reveal timestamp') }
      : {}),
    links: links.map((link) => {
      if (!isRecord(link)) throw new Error('Invalid ECHO signal link response.')
      return parseLink(link)
    }),
  }
}

function signalArguments(input: NetEchoGmSignalInput) {
  return {
    requested_kind: input.kind,
    requested_visibility_mode: input.visibilityMode,
    requested_title: input.title,
    requested_summary: input.summary ?? null,
    requested_body: input.body,
    requested_reliability: input.reliability,
    requested_intensity: input.intensity,
    requested_frequencies: [...input.frequencies],
    requested_map_x: input.mapX,
    requested_map_y: input.mapY,
    requested_integrity_percent: input.integrityPercent ?? null,
    requested_locked_teaser: input.lockedTeaser ?? null,
    requested_source_account_id: input.sourceAccountId ?? null,
    requested_source_label: input.sourceLabel ?? null,
    requested_location_label: input.locationLabel ?? null,
    requested_district_label: input.districtLabel ?? null,
    requested_occurred_at: input.occurredAt ?? null,
    requested_reference_app_id: input.primaryReference?.appId ?? null,
    requested_reference_resource_kind: input.primaryReference?.resourceKind ?? null,
    requested_reference_resource_id: input.primaryReference?.resourceId ?? null,
  }
}

export async function fetchNetEchoGmSignalDirectory(
  limit = NET_ECHO_GM_DIRECTORY_LIMIT,
): Promise<readonly NetEchoGmSignalDirectoryRow[]> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), NET_ECHO_GM_DIRECTORY_LIMIT)
  const { data, error } = await client().rpc('fetch_net_echo_gm_signal_directory', {
    requested_limit: boundedLimit,
  })
  if (error) throw mapError('ECHO signal directory could not be loaded', error.message)
  const rows = asRows(data)
  if (rows.length > NET_ECHO_GM_DIRECTORY_LIMIT) {
    throw new Error('ECHO signal directory exceeded its bounded response contract.')
  }
  return rows.map(parseDirectoryRow)
}

export async function fetchNetEchoGmSignal(
  signalId: string,
): Promise<NetEchoGmSignalDetail | null> {
  const { data, error } = await client().rpc('fetch_net_echo_gm_signal', {
    requested_signal_id: requiredString(signalId, 64, 'signal id'),
  })
  if (error) throw mapError('ECHO signal could not be loaded', error.message)
  const row = firstRow(data)
  return row ? parseSignalDetail(row) : null
}

export async function createNetEchoGmSignal(
  input: NetEchoGmSignalInput,
): Promise<NetEchoGmSignalDetail> {
  const { data, error } = await client().rpc('create_net_echo_gm_signal', signalArguments(input))
  if (error) throw mapError('ECHO signal draft could not be created', error.message)
  const row = firstRow(data)
  if (!row) throw new Error('ECHO signal creation returned no draft.')
  return parseSignalDetail(row)
}

export async function updateNetEchoGmSignal(
  signalId: string,
  input: NetEchoGmSignalInput,
): Promise<NetEchoGmSignalDetail> {
  const { data, error } = await client().rpc('update_net_echo_gm_signal', {
    requested_signal_id: requiredString(signalId, 64, 'signal id'),
    ...signalArguments(input),
  })
  if (error) throw mapError('ECHO signal could not be updated', error.message)
  const row = firstRow(data)
  if (!row) throw new Error('ECHO signal update returned no signal.')
  return parseSignalDetail(row)
}

export async function setNetEchoGmSignalLifecycle(
  signalId: string,
  status: NetEchoSignalStatus,
): Promise<NetEchoGmSignalDetail> {
  const { data, error } = await client().rpc('set_net_echo_gm_signal_lifecycle', {
    requested_signal_id: requiredString(signalId, 64, 'signal id'),
    requested_status: enumValue(status, netEchoSignalStatuses, 'signal status'),
  })
  if (error) throw mapError('ECHO lifecycle could not be updated', error.message)
  const row = firstRow(data)
  if (!row) throw new Error('ECHO lifecycle update returned no signal.')
  return parseSignalDetail(row)
}

export async function setNetEchoGmSignalLink(input: {
  readonly fromSignalId: string
  readonly toSignalId: string
  readonly relationshipKind: NetEchoRelationshipKind
  readonly label?: string
  readonly desiredLinked: boolean
}): Promise<NetEchoGmSignalDetail> {
  const { data, error } = await client().rpc('set_net_echo_gm_signal_link', {
    requested_from_signal_id: requiredString(input.fromSignalId, 64, 'link source id'),
    requested_to_signal_id: requiredString(input.toSignalId, 64, 'link target id'),
    requested_relationship_kind: enumValue(
      input.relationshipKind,
      netEchoRelationshipKinds,
      'link relationship',
    ),
    requested_label: input.label ?? null,
    requested_desired_linked: input.desiredLinked,
  })
  if (error) throw mapError('ECHO signal link could not be updated', error.message)
  const row = firstRow(data)
  if (!row) throw new Error('ECHO link update returned no signal.')
  return parseSignalDetail(row)
}

export async function fetchNetEchoGmGrantTargets(
  signalId: string,
  limit = NET_ECHO_GM_GRANT_TARGET_LIMIT,
): Promise<readonly NetEchoGmGrantTarget[]> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), NET_ECHO_GM_GRANT_TARGET_LIMIT)
  const { data, error } = await client().rpc('fetch_net_echo_gm_grant_targets', {
    requested_signal_id: requiredString(signalId, 64, 'signal id'),
    requested_limit: boundedLimit,
  })
  if (error) throw mapError('ECHO grant targets could not be loaded', error.message)
  const rows = asRows(data)
  if (rows.length > NET_ECHO_GM_GRANT_TARGET_LIMIT) {
    throw new Error('ECHO grant targets exceeded the bounded response contract.')
  }
  return rows.map((row) => ({
    accountId: requiredString(row.account_id, 64, 'grant account id'),
    handle: requiredString(row.handle, 32, 'grant account handle'),
    displayName: requiredString(row.display_name, 160, 'grant display name'),
    ...(optionalString(row.avatar_url, 2048, 'grant avatar')
      ? { avatarUrl: optionalString(row.avatar_url, 2048, 'grant avatar') }
      : {}),
    subjectKind: requiredString(row.subject_kind, 32, 'grant subject kind'),
    subjectId: requiredString(row.subject_id, 64, 'grant subject id'),
    granted: row.granted === true,
  }))
}

export async function setNetEchoGmSignalGrant(input: {
  readonly signalId: string
  readonly accountId: string
  readonly desiredGranted: boolean
}): Promise<NetEchoGmGrantResult> {
  const { data, error } = await client().rpc('set_net_echo_gm_signal_grant', {
    requested_signal_id: requiredString(input.signalId, 64, 'signal id'),
    requested_target_account_id: requiredString(input.accountId, 64, 'grant account id'),
    requested_desired_granted: input.desiredGranted,
  })
  if (error) throw mapError('ECHO signal grant could not be updated', error.message)
  const row = firstRow(data)
  if (!row || typeof row.granted !== 'boolean') {
    throw new Error('ECHO grant update returned an invalid response.')
  }
  return {
    signalId: requiredString(row.signal_id, 64, 'grant signal id'),
    accountId: requiredString(row.account_id, 64, 'grant account id'),
    granted: row.granted,
  }
}
