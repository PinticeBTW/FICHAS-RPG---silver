import { normalizeNetHandle } from '../components/net/accounts/netAppAccountSelectors'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import {
  NET_ECHO_BODY_MAX_LENGTH,
  NET_ECHO_LOCKED_TEASER_MAX_LENGTH,
  NET_ECHO_MAP_EDGE_LIMIT,
  NET_ECHO_MAP_NODE_LIMIT,
  NET_ECHO_SUMMARY_MAX_LENGTH,
  NET_ECHO_TITLE_MAX_LENGTH,
  NetEchoContextChangedError,
  netEchoIntensities,
  netEchoRelationshipKinds,
  netEchoReliabilities,
  netEchoSignalKinds,
  type NetEchoAccountStatus,
  type NetEchoIntensity,
  type NetEchoMapEdge,
  type NetEchoMapNode,
  type NetEchoMapProjection,
  type NetEchoPrimaryReference,
  type NetEchoProvisionedAccount,
  type NetEchoReliability,
  type NetEchoRelationshipKind,
  type NetEchoRequestContext,
  type NetEchoSaveResult,
  type NetEchoSignalDetail,
  type NetEchoSignalKind,
  type NetEchoSignalSource,
} from './netEchoTypes'

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function optionalString(value: unknown, maximumLength: number): string | undefined {
  if (value === null || value === undefined) return undefined
  if (!isNonEmptyString(value) || value.length > maximumLength) {
    throw new Error('Invalid optional ECHO text returned by the server.')
  }
  return value
}

function requiredString(value: unknown, maximumLength: number, label: string): string {
  if (!isNonEmptyString(value) || value.length > maximumLength) {
    throw new Error(`Invalid ${label} returned by the ECHO server.`)
  }
  return value
}

function requiredTimestamp(value: unknown, label: string): string {
  const timestamp = requiredString(value, 64, label)
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`Invalid ${label} returned by the ECHO server.`)
  }
  return timestamp
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return requiredTimestamp(value, label)
}

function coordinate(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`Invalid ${label} returned by the ECHO server.`)
  }
  return parsed
}

function parseIntegrity(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error('Invalid signal integrity returned by the ECHO server.')
  }
  return parsed
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`Invalid ${label} returned by the ECHO server.`)
  }
  return value as T[number]
}

function parseFrequencies(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 10) {
    throw new Error('Invalid frequencies returned by the ECHO server.')
  }
  return value.map((frequency) => requiredString(frequency, 320, 'frequency'))
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return isRecord(candidate) ? candidate : null
}

function mapRpcError(prefix: string, message: string): Error {
  if (message.includes('ECHO_ACCOUNT_CONTEXT_CHANGED')) {
    return new NetEchoContextChangedError()
  }
  return new Error(`${prefix}: ${message}`)
}

function assertContext(context: NetEchoRequestContext): string {
  return requiredString(context.expectedAccountId, 64, 'expected ECHO account')
}

function parseVisibleMapNode(row: Record<string, unknown>): NetEchoMapNode {
  const id = requiredString(row.id, 64, 'signal id')
  const mapX = coordinate(row.map_x, 'map x coordinate')
  const mapY = coordinate(row.map_y, 'map y coordinate')

  if (row.access_state === 'locked') {
    if (row.kind !== 'encrypted' || row.viewer_discovered !== false || row.viewer_saved !== false) {
      throw new Error('Invalid locked signal projection returned by the ECHO server.')
    }
    return {
      id,
      accessState: 'locked',
      mapX,
      mapY,
      lockedTeaser: requiredString(
        row.locked_teaser,
        NET_ECHO_LOCKED_TEASER_MAX_LENGTH,
        'locked teaser',
      ),
      kind: 'encrypted',
      viewerDiscovered: false,
      viewerSaved: false,
    }
  }

  if (
    row.access_state !== 'visible'
    || typeof row.viewer_discovered !== 'boolean'
    || typeof row.viewer_saved !== 'boolean'
  ) {
    throw new Error('Invalid visible signal projection returned by the ECHO server.')
  }

  return {
    id,
    accessState: 'visible',
    mapX,
    mapY,
    title: requiredString(row.title, NET_ECHO_TITLE_MAX_LENGTH, 'signal title'),
    kind: enumValue(row.kind, netEchoSignalKinds, 'signal kind') as NetEchoSignalKind,
    intensity: enumValue(row.intensity, netEchoIntensities, 'signal intensity') as NetEchoIntensity,
    frequencies: parseFrequencies(row.frequencies),
    reliability: enumValue(
      row.reliability,
      netEchoReliabilities,
      'signal reliability',
    ) as NetEchoReliability,
    ...(optionalString(row.district_label, 80)
      ? { districtLabel: optionalString(row.district_label, 80) }
      : {}),
    viewerDiscovered: row.viewer_discovered,
    viewerSaved: row.viewer_saved,
    revealedAt: requiredTimestamp(row.revealed_at, 'signal reveal timestamp'),
  }
}

function parseMapEdge(row: Record<string, unknown>): NetEchoMapEdge {
  return {
    fromSignalId: requiredString(row.from_signal_id, 64, 'edge source id'),
    toSignalId: requiredString(row.to_signal_id, 64, 'edge target id'),
    relationshipKind: enumValue(
      row.relationship_kind,
      netEchoRelationshipKinds,
      'relationship kind',
    ) as NetEchoRelationshipKind,
    ...(optionalString(row.label, 80) ? { label: optionalString(row.label, 80) } : {}),
  }
}

function parseMapProjection(value: unknown): NetEchoMapProjection {
  if (!isRecord(value)) throw new Error('Invalid ECHO map response.')
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('Invalid ECHO map collections returned by the server.')
  }
  const nodeRows = value.nodes
  const edgeRows = value.edges
  if (nodeRows.length > NET_ECHO_MAP_NODE_LIMIT || edgeRows.length > NET_ECHO_MAP_EDGE_LIMIT) {
    throw new Error('The ECHO map exceeded its bounded response contract.')
  }

  const nodes = nodeRows.map((row) => {
    if (!isRecord(row)) throw new Error('Invalid ECHO map node response.')
    return parseVisibleMapNode(row)
  })
  const representedNodes = new Map(nodes.map((node) => [node.id, node]))
  const edges = edgeRows.map((row) => {
    if (!isRecord(row)) throw new Error('Invalid ECHO map edge response.')
    const edge = parseMapEdge(row)
    if (
      representedNodes.get(edge.fromSignalId)?.accessState !== 'visible'
      || representedNodes.get(edge.toSignalId)?.accessState !== 'visible'
    ) {
      throw new Error('ECHO returned an edge outside the fully visible map projection.')
    }
    return edge
  })

  return { nodes, edges }
}

function parsePrimaryReference(row: Record<string, unknown>): NetEchoPrimaryReference | undefined {
  const appId = optionalString(row.primary_reference_app_id, 32)
  const resourceKind = optionalString(row.primary_reference_resource_kind, 40)
  const resourceId = optionalString(row.primary_reference_resource_id, 160)
  if (!appId && !resourceKind && !resourceId) return undefined
  if (!appId || !resourceKind || !resourceId) {
    throw new Error('Invalid ECHO primary reference returned by the server.')
  }
  return { appId, resourceKind, resourceId }
}

function parseSource(row: Record<string, unknown>): NetEchoSignalSource | undefined {
  const accountId = optionalString(row.source_account_id, 64)
  const rawHandle = optionalString(row.source_handle, 32)
  const handle = rawHandle ? normalizeNetHandle(rawHandle) : undefined
  if (rawHandle && !handle) throw new Error('Invalid ECHO source handle returned by the server.')
  const displayName = optionalString(row.source_display_name, 40)
  const avatarUrl = optionalString(row.source_avatar_url, 2048)
  const label = optionalString(row.source_label, 120)
  if (!accountId && !handle && !displayName && !avatarUrl && !label) return undefined
  return {
    ...(accountId ? { accountId } : {}),
    ...(handle ? { handle } : {}),
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(label ? { label } : {}),
  }
}

function parseSignalDetail(row: Record<string, unknown>): NetEchoSignalDetail {
  if (row.viewer_discovered !== true || typeof row.viewer_saved !== 'boolean') {
    throw new Error('Invalid ECHO viewer state returned by the server.')
  }
  return {
    id: requiredString(row.signal_id, 64, 'signal id'),
    kind: enumValue(row.kind, netEchoSignalKinds, 'signal kind') as NetEchoSignalKind,
    title: requiredString(row.title, NET_ECHO_TITLE_MAX_LENGTH, 'signal title'),
    ...(optionalString(row.summary, NET_ECHO_SUMMARY_MAX_LENGTH)
      ? { summary: optionalString(row.summary, NET_ECHO_SUMMARY_MAX_LENGTH) }
      : {}),
    body: requiredString(row.body, NET_ECHO_BODY_MAX_LENGTH, 'signal body'),
    reliability: enumValue(
      row.reliability,
      netEchoReliabilities,
      'signal reliability',
    ) as NetEchoReliability,
    intensity: enumValue(row.intensity, netEchoIntensities, 'signal intensity') as NetEchoIntensity,
    frequencies: parseFrequencies(row.frequencies),
    mapX: coordinate(row.map_x, 'map x coordinate'),
    mapY: coordinate(row.map_y, 'map y coordinate'),
    ...(parseIntegrity(row.integrity_percent) !== undefined
      ? { integrityPercent: parseIntegrity(row.integrity_percent) }
      : {}),
    ...(parseSource(row) ? { source: parseSource(row) } : {}),
    ...(optionalString(row.location_label, 120)
      ? { locationLabel: optionalString(row.location_label, 120) }
      : {}),
    ...(optionalString(row.district_label, 80)
      ? { districtLabel: optionalString(row.district_label, 80) }
      : {}),
    ...(optionalTimestamp(row.occurred_at, 'signal occurrence timestamp')
      ? { occurredAt: optionalTimestamp(row.occurred_at, 'signal occurrence timestamp') }
      : {}),
    ...(parsePrimaryReference(row) ? { primaryReference: parsePrimaryReference(row) } : {}),
    revealedAt: requiredTimestamp(row.revealed_at, 'signal reveal timestamp'),
    viewerDiscovered: true,
    viewerSaved: row.viewer_saved,
  }
}

function parseProvisionedAccount(row: Record<string, unknown>): NetEchoProvisionedAccount {
  const handle = normalizeNetHandle(requiredString(row.handle, 32, 'ECHO handle'))
  if (!handle) throw new Error('Invalid ECHO handle returned by the server.')
  const status = row.status
  if (status !== 'active' && status !== 'suspended' && status !== 'disabled') {
    throw new Error('Invalid ECHO account status returned by the server.')
  }
  return {
    accountId: requiredString(row.account_id, 64, 'ECHO account id'),
    handle,
    status: status as NetEchoAccountStatus,
    createdAt: requiredTimestamp(row.created_at, 'ECHO account creation timestamp'),
    updatedAt: requiredTimestamp(row.updated_at, 'ECHO account update timestamp'),
  }
}

export async function provisionNetEchoAccount(input: {
  readonly expectedIdentityLinkId: string
  readonly handle: string
}): Promise<NetEchoProvisionedAccount> {
  const expectedIdentityLinkId = requiredString(
    input.expectedIdentityLinkId,
    64,
    'expected ECHO identity',
  )
  const handle = normalizeNetHandle(input.handle)
  if (!handle) throw new Error('ECHO handle is invalid.')

  const { data, error } = await client().rpc('create_net_echo_account', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_handle: handle,
  })
  if (error) throw mapRpcError('ECHO account could not be provisioned', error.message)
  const row = firstRow(data)
  if (!row) throw new Error('ECHO account provisioning returned no account.')
  return parseProvisionedAccount(row)
}

export async function fetchNetEchoMap(
  context: NetEchoRequestContext,
  options: {
    readonly nodeLimit?: number
    readonly edgeLimit?: number
  } = {},
): Promise<NetEchoMapProjection> {
  const nodeLimit = Math.min(Math.max(Math.trunc(options.nodeLimit ?? NET_ECHO_MAP_NODE_LIMIT), 1), NET_ECHO_MAP_NODE_LIMIT)
  const edgeLimit = Math.min(Math.max(Math.trunc(options.edgeLimit ?? NET_ECHO_MAP_EDGE_LIMIT), 1), NET_ECHO_MAP_EDGE_LIMIT)
  const { data, error } = await client().rpc('fetch_net_echo_map', {
    requested_expected_account_id: assertContext(context),
    requested_node_limit: nodeLimit,
    requested_edge_limit: edgeLimit,
  })
  if (error) throw mapRpcError('ECHO map could not be loaded', error.message)
  return parseMapProjection(data)
}

export async function openNetEchoSignal(
  signalId: string,
  context: NetEchoRequestContext,
): Promise<NetEchoSignalDetail | null> {
  const { data, error } = await client().rpc('open_net_echo_signal', {
    requested_signal_id: requiredString(signalId, 64, 'signal id'),
    requested_expected_account_id: assertContext(context),
  })
  if (error) throw mapRpcError('ECHO signal could not be opened', error.message)
  const row = firstRow(data)
  return row ? parseSignalDetail(row) : null
}

export async function setNetEchoSignalSaved(input: {
  readonly signalId: string
  readonly desiredSaved: boolean
  readonly context: NetEchoRequestContext
}): Promise<NetEchoSaveResult> {
  const { data, error } = await client().rpc('set_net_echo_signal_saved', {
    requested_signal_id: requiredString(input.signalId, 64, 'signal id'),
    requested_desired_saved: input.desiredSaved,
    requested_expected_account_id: assertContext(input.context),
  })
  if (error) throw mapRpcError('ECHO save state could not be updated', error.message)
  const row = firstRow(data)
  if (!row || typeof row.viewer_saved !== 'boolean') {
    throw new Error('ECHO save state returned an invalid response.')
  }
  const savedAt = optionalTimestamp(row.saved_at, 'ECHO save timestamp')
  if (row.viewer_saved !== Boolean(savedAt)) {
    throw new Error('ECHO save state returned inconsistent confirmation.')
  }
  return {
    signalId: requiredString(row.signal_id, 64, 'signal id'),
    viewerSaved: row.viewer_saved,
    ...(savedAt ? { savedAt } : {}),
  }
}
