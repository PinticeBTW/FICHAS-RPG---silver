import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import {
  NET_SEARCH_ALIAS_MAX_ITEMS,
  NET_SEARCH_ALIAS_MAX_LENGTH,
  NET_SEARCH_CONTENT_MAX_LENGTH,
  NET_SEARCH_GM_DIRECTORY_MAX_LIMIT,
  NET_SEARCH_QUERY_MAX_LENGTH,
  NET_SEARCH_QUERY_MIN_LENGTH,
  NET_SEARCH_REFERENCE_MAX_ITEMS,
  NET_SEARCH_REFERENCE_MAX_LENGTH,
  NET_SEARCH_RESULT_DEFAULT_LIMIT,
  NET_SEARCH_RESULT_MAX_LIMIT,
  NET_SEARCH_SUMMARY_MAX_LENGTH,
  NET_SEARCH_TAG_MAX_ITEMS,
  NET_SEARCH_TAG_MAX_LENGTH,
  NET_SEARCH_TITLE_MAX_LENGTH,
  NetSearchRequestError,
  netSearchEntryStatuses,
  netSearchEntryTypes,
  netSearchGmLifecycleFilters,
  netSearchVisibilities,
  type NetSearchEntryDetail,
  type NetSearchEntryStatus,
  type NetSearchEntryType,
  type NetSearchGmDirectoryRow,
  type NetSearchGmEntryDetail,
  type NetSearchGmEntryInput,
  type NetSearchGmLifecycleFilter,
  type NetSearchResult,
  type NetSearchVisibility,
} from './netSearchTypes'

interface SupabaseRpcErrorLike {
  readonly code?: string
  readonly message: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function client() {
  if (!supabase) throw new NetSearchRequestError('request-failed', SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalidResponse(message: string): never {
  throw new NetSearchRequestError('invalid-server-response', message)
}

function requiredString(value: unknown, maximumLength: number, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength) {
    return invalidResponse(`Invalid ${label} returned by VEIL Search.`)
  }
  return value
}

function uuid(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (!UUID_PATTERN.test(parsed)) return invalidResponse(`Invalid ${label} returned by VEIL Search.`)
  return parsed
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (Number.isNaN(Date.parse(parsed))) return invalidResponse(`Invalid ${label} returned by VEIL Search.`)
  return parsed
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return timestamp(value, label)
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    return invalidResponse(`Invalid ${label} returned by VEIL Search.`)
  }
  return value as T[number]
}

function stringArray(
  value: unknown,
  maximumItems: number,
  maximumItemLength: number,
  label: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    return invalidResponse(`Invalid ${label} returned by VEIL Search.`)
  }
  return value.map((item) => requiredString(item, maximumItemLength, label))
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalidResponse(`Invalid ${label} returned by VEIL Search.`)
  }
  return value
}

function rows(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    return invalidResponse('Invalid row set returned by VEIL Search.')
  }
  return value
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return isRecord(candidate) ? candidate : null
}

function mapRpcError(prefix: string, error: SupabaseRpcErrorLike): NetSearchRequestError {
  if (error.code === '42501' || error.message.includes('Authentication is required')) {
    const isGmFailure = error.message.includes('GM')
    return new NetSearchRequestError(
      isGmFailure ? 'permission-denied' : 'authentication-required',
      isGmFailure ? 'GM System authority is required.' : 'Sign in to use VEIL Search.',
    )
  }
  if (error.message.includes('NET_SEARCH_QUERY_INVALID')) {
    return new NetSearchRequestError(
      'invalid-query',
      `Search must contain ${NET_SEARCH_QUERY_MIN_LENGTH}–${NET_SEARCH_QUERY_MAX_LENGTH} characters.`,
    )
  }
  if (error.message.includes('NET_SEARCH_ENTRY_NOT_FOUND')) {
    return new NetSearchRequestError('entry-not-found', 'That knowledge entry no longer exists.')
  }
  if (error.message.includes('NET_SEARCH_LIFECYCLE_INVALID')) {
    return new NetSearchRequestError('invalid-lifecycle', 'That knowledge lifecycle change is not allowed.')
  }
  if (error.code === '22023' || error.message.includes('NET_SEARCH_INPUT_')) {
    return new NetSearchRequestError('invalid-input', 'The knowledge entry contains invalid or oversized fields.')
  }
  return new NetSearchRequestError('request-failed', `${prefix}: ${error.message}`)
}

function parseResult(row: Record<string, unknown>): NetSearchResult {
  const sourceKind = enumValue(row.source_kind, ['knowledge'] as const, 'source kind')
  return {
    id: uuid(row.id, 'entry id'),
    sourceKind,
    entryType: enumValue(row.entry_type, netSearchEntryTypes, 'entry type') as NetSearchEntryType,
    title: requiredString(row.title, NET_SEARCH_TITLE_MAX_LENGTH, 'title'),
    summary: requiredString(row.summary, NET_SEARCH_SUMMARY_MAX_LENGTH, 'summary'),
    excerpt: requiredString(row.excerpt, 420, 'excerpt'),
    tags: stringArray(row.tags, NET_SEARCH_TAG_MAX_ITEMS, NET_SEARCH_TAG_MAX_LENGTH, 'tag'),
    updatedAt: timestamp(row.updated_at, 'updated timestamp'),
    score: numberValue(row.rank_score, 'rank score'),
  }
}

function parseEntryDetail(row: Record<string, unknown>): NetSearchEntryDetail {
  const availableFrom = optionalTimestamp(row.available_from, 'availability timestamp')
  const expiresAt = optionalTimestamp(row.expires_at, 'expiry timestamp')
  return {
    ...parseResult(row),
    content: requiredString(row.content, NET_SEARCH_CONTENT_MAX_LENGTH, 'content'),
    aliases: stringArray(row.aliases, NET_SEARCH_ALIAS_MAX_ITEMS, NET_SEARCH_ALIAS_MAX_LENGTH, 'alias'),
    relatedReferences: stringArray(
      row.related_references,
      NET_SEARCH_REFERENCE_MAX_ITEMS,
      NET_SEARCH_REFERENCE_MAX_LENGTH,
      'related reference',
    ),
    ...(availableFrom ? { availableFrom } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  }
}

function parseGmDirectoryRow(row: Record<string, unknown>): NetSearchGmDirectoryRow {
  const availableFrom = optionalTimestamp(row.available_from, 'availability timestamp')
  const expiresAt = optionalTimestamp(row.expires_at, 'expiry timestamp')
  return {
    id: uuid(row.id, 'entry id'),
    title: requiredString(row.title, NET_SEARCH_TITLE_MAX_LENGTH, 'title'),
    entryType: enumValue(row.entry_type, netSearchEntryTypes, 'entry type') as NetSearchEntryType,
    visibility: enumValue(row.visibility, netSearchVisibilities, 'visibility') as NetSearchVisibility,
    status: enumValue(row.status, netSearchEntryStatuses, 'status') as NetSearchEntryStatus,
    ...(availableFrom ? { availableFrom } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    updatedAt: timestamp(row.updated_at, 'updated timestamp'),
  }
}

function parseGmDetail(row: Record<string, unknown>): NetSearchGmEntryDetail {
  const availableFrom = optionalTimestamp(row.available_from, 'availability timestamp')
  const expiresAt = optionalTimestamp(row.expires_at, 'expiry timestamp')
  const archivedAt = optionalTimestamp(row.archived_at, 'archive timestamp')
  return {
    id: uuid(row.id, 'entry id'),
    title: requiredString(row.title, NET_SEARCH_TITLE_MAX_LENGTH, 'title'),
    entryType: enumValue(row.entry_type, netSearchEntryTypes, 'entry type') as NetSearchEntryType,
    summary: requiredString(row.summary, NET_SEARCH_SUMMARY_MAX_LENGTH, 'summary'),
    content: requiredString(row.content, NET_SEARCH_CONTENT_MAX_LENGTH, 'content'),
    aliases: stringArray(row.aliases, NET_SEARCH_ALIAS_MAX_ITEMS, NET_SEARCH_ALIAS_MAX_LENGTH, 'alias'),
    tags: stringArray(row.tags, NET_SEARCH_TAG_MAX_ITEMS, NET_SEARCH_TAG_MAX_LENGTH, 'tag'),
    visibility: enumValue(row.visibility, netSearchVisibilities, 'visibility') as NetSearchVisibility,
    ...(availableFrom ? { availableFrom } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    relatedReferences: stringArray(
      row.related_references,
      NET_SEARCH_REFERENCE_MAX_ITEMS,
      NET_SEARCH_REFERENCE_MAX_LENGTH,
      'related reference',
    ),
    status: enumValue(row.status, netSearchEntryStatuses, 'status') as NetSearchEntryStatus,
    createdAt: timestamp(row.created_at, 'created timestamp'),
    updatedAt: timestamp(row.updated_at, 'updated timestamp'),
    ...(archivedAt ? { archivedAt } : {}),
  }
}

function validateQuery(query: string): string {
  const normalized = query.trim()
  if (normalized.length < NET_SEARCH_QUERY_MIN_LENGTH || normalized.length > NET_SEARCH_QUERY_MAX_LENGTH) {
    throw new NetSearchRequestError(
      'invalid-query',
      `Search must contain ${NET_SEARCH_QUERY_MIN_LENGTH}–${NET_SEARCH_QUERY_MAX_LENGTH} characters.`,
    )
  }
  return normalized
}

export async function searchNetKnowledge(
  query: string,
  limit = NET_SEARCH_RESULT_DEFAULT_LIMIT,
): Promise<readonly NetSearchResult[]> {
  const normalized = validateQuery(query)
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), NET_SEARCH_RESULT_MAX_LIMIT)
  const { data, error } = await client().rpc('search_net_knowledge', {
    requested_query: normalized,
    requested_limit: boundedLimit,
  })
  if (error) throw mapRpcError('VEIL Search failed', error)
  return rows(data).map(parseResult)
}

export async function fetchNetSearchHome(limit = 8): Promise<readonly NetSearchResult[]> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 12)
  const { data, error } = await client().rpc('fetch_net_search_home', {
    requested_limit: boundedLimit,
  })
  if (error) throw mapRpcError('VEIL Search home failed', error)
  return rows(data).map(parseResult)
}

export async function fetchNetSearchEntry(entryId: string): Promise<NetSearchEntryDetail | null> {
  if (!UUID_PATTERN.test(entryId)) return null
  const { data, error } = await client().rpc('fetch_net_search_entry', {
    requested_entry_id: entryId,
  })
  if (error) throw mapRpcError('Knowledge entry failed to open', error)
  const row = firstRow(data)
  return row ? parseEntryDetail(row) : null
}

export async function fetchNetSearchGmDirectory(input: {
  readonly query?: string
  readonly visibility?: NetSearchVisibility | 'all'
  readonly lifecycle?: NetSearchGmLifecycleFilter
  readonly limit?: number
} = {}): Promise<readonly NetSearchGmDirectoryRow[]> {
  const lifecycle = input.lifecycle ?? 'all'
  if (!netSearchGmLifecycleFilters.includes(lifecycle)) {
    throw new NetSearchRequestError('invalid-input', 'Invalid knowledge lifecycle filter.')
  }
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? NET_SEARCH_GM_DIRECTORY_MAX_LIMIT), 1),
    NET_SEARCH_GM_DIRECTORY_MAX_LIMIT,
  )
  const { data, error } = await client().rpc('fetch_net_search_gm_directory', {
    requested_query: input.query?.trim() || null,
    requested_visibility: input.visibility === 'all' ? null : input.visibility ?? null,
    requested_lifecycle: lifecycle,
    requested_limit: limit,
  })
  if (error) throw mapRpcError('Knowledge directory failed to load', error)
  return rows(data).map(parseGmDirectoryRow)
}

export async function fetchNetSearchGmEntry(entryId: string): Promise<NetSearchGmEntryDetail | null> {
  if (!UUID_PATTERN.test(entryId)) return null
  const { data, error } = await client().rpc('fetch_net_search_gm_entry', {
    requested_entry_id: entryId,
  })
  if (error) throw mapRpcError('Knowledge entry failed to load', error)
  const row = firstRow(data)
  return row ? parseGmDetail(row) : null
}

export async function saveNetSearchGmEntry(
  entryId: string | null,
  input: NetSearchGmEntryInput,
): Promise<NetSearchGmEntryDetail> {
  const { data, error } = await client().rpc('save_net_search_gm_entry', {
    requested_entry_id: entryId,
    requested_title: input.title,
    requested_entry_type: input.entryType,
    requested_summary: input.summary,
    requested_content: input.content,
    requested_aliases: [...input.aliases],
    requested_tags: [...input.tags],
    requested_visibility: input.visibility,
    requested_available_from: input.availableFrom ?? null,
    requested_expires_at: input.expiresAt ?? null,
    requested_related_references: [...input.relatedReferences],
  })
  if (error) throw mapRpcError('Knowledge entry failed to save', error)
  const row = firstRow(data)
  if (!row) return invalidResponse('VEIL Search did not return the saved knowledge entry.')
  return parseGmDetail(row)
}

export async function setNetSearchGmEntryLifecycle(
  entryId: string,
  action: 'archive' | 'restore',
): Promise<NetSearchGmEntryDetail> {
  const { data, error } = await client().rpc('set_net_search_gm_entry_lifecycle', {
    requested_entry_id: entryId,
    requested_action: action,
  })
  if (error) throw mapRpcError('Knowledge lifecycle failed to change', error)
  const row = firstRow(data)
  if (!row) return invalidResponse('VEIL Search did not return the updated knowledge entry.')
  return parseGmDetail(row)
}

export async function deleteNetSearchGmEntry(entryId: string): Promise<boolean> {
  const { data, error } = await client().rpc('delete_net_search_gm_entry', {
    requested_entry_id: entryId,
  })
  if (error) throw mapRpcError('Knowledge entry failed to delete', error)
  if (typeof data !== 'boolean') return invalidResponse('VEIL Search returned an invalid deletion result.')
  return data
}
