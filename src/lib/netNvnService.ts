import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import { prewarmSharedMediaUrls } from './media/mediaStorage'
import { parseNetNvnArticleMedia } from './netNvnMediaContract'
import {
  NET_NVN_BODY_MAX_LENGTH,
  NET_NVN_BYLINE_NAME_MAX_LENGTH,
  NET_NVN_BYLINE_ROLE_MAX_LENGTH,
  NET_NVN_HEADLINE_MAX_LENGTH,
  NET_NVN_PAGE_DEFAULT_LIMIT,
  NET_NVN_PAGE_MAX_LIMIT,
  NET_NVN_SEARCH_MAX_LENGTH,
  NET_NVN_SEARCH_MIN_LENGTH,
  NET_NVN_SHORT_HEADLINE_MAX_LENGTH,
  NET_NVN_SLUG_MAX_LENGTH,
  NET_NVN_SOURCE_LABEL_MAX_ITEMS,
  NET_NVN_SOURCE_LABEL_MAX_LENGTH,
  NET_NVN_SUMMARY_MAX_LENGTH,
  NET_NVN_TAG_MAX_ITEMS,
  NET_NVN_TAG_MAX_LENGTH,
  NetNvnRequestError,
  netNvnArticlePageModes,
  netNvnBylineKinds,
  netNvnCategories,
  netNvnPlayerArticleStatuses,
  netNvnPriorities,
  netNvnSourceStatuses,
  netNvnStoryKinds,
  type NetNvnArticleCursor,
  type NetNvnArticleDetail,
  type NetNvnArticlePage,
  type NetNvnArticlePageRequest,
  type NetNvnArticlePublicMetadata,
  type NetNvnArticleSummary,
  type NetNvnBylineKind,
  type NetNvnCategory,
  type NetNvnPlayerArticleStatus,
  type NetNvnPrimaryReference,
  type NetNvnPriority,
  type NetNvnSourceStatus,
  type NetNvnStoryKind,
} from './netNvnTypes'

interface SupabaseRpcErrorLike {
  readonly code?: string
  readonly message: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function client() {
  if (!supabase) throw new NetNvnRequestError('request-failed', SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalidResponse(message: string): never {
  throw new NetNvnRequestError('invalid-server-response', message)
}

function requiredString(value: unknown, maximumLength: number, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength) {
    return invalidResponse(`Invalid ${label} returned by the NVN server.`)
  }
  return value
}

function optionalString(value: unknown, maximumLength: number, label: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return requiredString(value, maximumLength, label)
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    return invalidResponse(`Invalid ${label} returned by the NVN server.`)
  }
  return value as T[number]
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (Number.isNaN(Date.parse(parsed))) {
    return invalidResponse(`Invalid ${label} returned by the NVN server.`)
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
    return invalidResponse(`Invalid ${label} returned by the NVN server.`)
  }
  return parsed
}

function textArray(
  value: unknown,
  maximumItems: number,
  maximumItemLength: number,
  label: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    return invalidResponse(`Invalid ${label} returned by the NVN server.`)
  }
  return value.map((item) => requiredString(item, maximumItemLength, label))
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return isRecord(candidate) ? candidate : null
}

function mapRpcError(prefix: string, error: SupabaseRpcErrorLike): NetNvnRequestError {
  if (error.code === '42501' || error.message.includes('Authentication is required')) {
    return new NetNvnRequestError(
      'authentication-required',
      'Sign in to read New Vega Network.',
    )
  }
  if (error.message.includes('NVN_SEARCH_QUERY_')) {
    return new NetNvnRequestError(
      'invalid-search-query',
      `Search must contain ${NET_NVN_SEARCH_MIN_LENGTH}–${NET_NVN_SEARCH_MAX_LENGTH} characters.`,
    )
  }
  if (
    error.message.includes('NVN_PAGE_MODE_')
    || error.message.includes('NVN_CATEGORY_')
    || error.message.includes('NVN_CURSOR_')
  ) {
    return new NetNvnRequestError('invalid-page-request', 'The NVN page request is invalid.')
  }
  return new NetNvnRequestError('request-failed', `${prefix}: ${error.message}`)
}

function parsePrimaryReference(row: Record<string, unknown>): NetNvnPrimaryReference | undefined {
  const appId = optionalString(row.primary_reference_app_id, 32, 'reference application')
  const resourceKind = optionalString(row.primary_reference_resource_kind, 40, 'reference kind')
  const resourceId = optionalString(row.primary_reference_resource_id, 160, 'reference id')
  if (!appId && !resourceKind && !resourceId) return undefined
  if (!appId || !resourceKind || !resourceId) {
    return invalidResponse('Invalid primary reference returned by the NVN server.')
  }
  return { appId, resourceKind, resourceId }
}

function parsePublicMetadata(row: Record<string, unknown>): NetNvnArticlePublicMetadata {
  const status = enumValue(
    row.status,
    netNvnPlayerArticleStatuses,
    'article lifecycle',
  ) as NetNvnPlayerArticleStatus
  const archivedAt = optionalTimestamp(row.archived_at, 'archive timestamp')
  if ((status === 'archived') !== Boolean(archivedAt)) {
    return invalidResponse('Inconsistent NVN article lifecycle returned by the server.')
  }
  const shortHeadline = optionalString(
    row.short_headline,
    NET_NVN_SHORT_HEADLINE_MAX_LENGTH,
    'short headline',
  )
  const summary = optionalString(row.summary, NET_NVN_SUMMARY_MAX_LENGTH, 'article summary')
  const bylineRole = optionalString(
    row.byline_role,
    NET_NVN_BYLINE_ROLE_MAX_LENGTH,
    'byline role',
  )
  const districtLabel = optionalString(row.district_label, 120, 'district label')
  const locationLabel = optionalString(row.location_label, 120, 'location label')
  const occurredAt = optionalTimestamp(row.occurred_at, 'article occurrence timestamp')

  return {
    id: uuid(row.id, 'article id'),
    slug: requiredString(row.slug, NET_NVN_SLUG_MAX_LENGTH, 'article slug'),
    status,
    headline: requiredString(row.headline, NET_NVN_HEADLINE_MAX_LENGTH, 'article headline'),
    ...(shortHeadline ? { shortHeadline } : {}),
    ...(summary ? { summary } : {}),
    storyKind: enumValue(row.story_kind, netNvnStoryKinds, 'story kind') as NetNvnStoryKind,
    priority: enumValue(row.priority, netNvnPriorities, 'article priority') as NetNvnPriority,
    category: enumValue(row.category, netNvnCategories, 'article category') as NetNvnCategory,
    bylineName: requiredString(row.byline_name, NET_NVN_BYLINE_NAME_MAX_LENGTH, 'byline name'),
    ...(bylineRole ? { bylineRole } : {}),
    bylineKind: enumValue(row.byline_kind, netNvnBylineKinds, 'byline kind') as NetNvnBylineKind,
    sourceStatus: enumValue(
      row.source_status,
      netNvnSourceStatuses,
      'source status',
    ) as NetNvnSourceStatus,
    tags: textArray(row.tags, NET_NVN_TAG_MAX_ITEMS, NET_NVN_TAG_MAX_LENGTH, 'article tag'),
    ...(districtLabel ? { districtLabel } : {}),
    ...(locationLabel ? { locationLabel } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    publishedAt: timestamp(row.published_at, 'publication timestamp'),
    updatedAt: timestamp(row.updated_at, 'article update timestamp'),
    ...(archivedAt ? { archivedAt } : {}),
  }
}

function parseArticleSummary(row: Record<string, unknown>): NetNvnArticleSummary {
  const metadata = parsePublicMetadata(row)
  const pageSortAt = timestamp(row.page_sort_at, 'page cursor timestamp')
  const expectedSortAt = metadata.status === 'archived' ? metadata.archivedAt : metadata.publishedAt
  if (pageSortAt !== expectedSortAt) {
    return invalidResponse('Inconsistent NVN page cursor returned by the server.')
  }
  return { ...metadata, pageSortAt }
}

function parseArticleDetail(row: Record<string, unknown>): NetNvnArticleDetail {
  const metadata = parsePublicMetadata(row)
  const pullQuote = optionalString(row.pull_quote, 600, 'pull quote')
  const pullQuoteAttribution = optionalString(
    row.pull_quote_attribution,
    160,
    'pull quote attribution',
  )
  if (Boolean(pullQuote) !== Boolean(pullQuoteAttribution)) {
    return invalidResponse('Incomplete pull quote returned by the NVN server.')
  }
  const primaryReference = parsePrimaryReference(row)
  const media = parseNetNvnArticleMedia(row.media, invalidResponse)

  return {
    ...metadata,
    body: requiredString(row.body, NET_NVN_BODY_MAX_LENGTH, 'article body'),
    sourceLabels: textArray(
      row.source_labels,
      NET_NVN_SOURCE_LABEL_MAX_ITEMS,
      NET_NVN_SOURCE_LABEL_MAX_LENGTH,
      'source label',
    ),
    ...(pullQuote ? { pullQuote, pullQuoteAttribution: pullQuoteAttribution! } : {}),
    ...(primaryReference ? { primaryReference } : {}),
    media,
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return NET_NVN_PAGE_DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(limit), 1), NET_NVN_PAGE_MAX_LIMIT)
}

function normalizeSearchQuery(query: string | undefined, required: boolean): string | undefined {
  if (query === undefined) {
    if (required) {
      throw new NetNvnRequestError('invalid-search-query', 'Enter a search query.')
    }
    return undefined
  }
  if (query.length > NET_NVN_SEARCH_MAX_LENGTH) {
    throw new NetNvnRequestError(
      'invalid-search-query',
      `Search must contain ${NET_NVN_SEARCH_MIN_LENGTH}–${NET_NVN_SEARCH_MAX_LENGTH} characters.`,
    )
  }
  const normalized = query.trim()
  if (normalized.length < NET_NVN_SEARCH_MIN_LENGTH) {
    throw new NetNvnRequestError(
      'invalid-search-query',
      `Search must contain ${NET_NVN_SEARCH_MIN_LENGTH}–${NET_NVN_SEARCH_MAX_LENGTH} characters.`,
    )
  }
  return normalized
}

function normalizeCursor(cursor: NetNvnArticleCursor | undefined): NetNvnArticleCursor | undefined {
  if (!cursor) return undefined
  if (
    typeof cursor.at !== 'string'
    || Number.isNaN(Date.parse(cursor.at))
    || typeof cursor.id !== 'string'
    || !UUID_PATTERN.test(cursor.id)
  ) {
    throw new NetNvnRequestError('invalid-page-request', 'The NVN page cursor is invalid.')
  }
  return { at: cursor.at, id: cursor.id }
}

function validatePageRequest(request: NetNvnArticlePageRequest): {
  readonly limit: number
  readonly searchQuery?: string
  readonly cursor?: NetNvnArticleCursor
} {
  if (!netNvnArticlePageModes.includes(request.mode)) {
    throw new NetNvnRequestError('invalid-page-request', 'The NVN page mode is invalid.')
  }
  if (request.category !== undefined && !netNvnCategories.includes(request.category)) {
    throw new NetNvnRequestError('invalid-page-request', 'The NVN category is invalid.')
  }
  if (request.mode === 'category' && !request.category) {
    throw new NetNvnRequestError('invalid-page-request', 'Choose an NVN category.')
  }
  if (request.mode === 'home' && request.category) {
    throw new NetNvnRequestError('invalid-page-request', 'Home does not accept a category filter.')
  }
  if (request.searchQuery !== undefined && request.mode !== 'search' && request.mode !== 'archive') {
    throw new NetNvnRequestError('invalid-page-request', 'Search is unavailable in this NVN mode.')
  }
  const searchQuery = normalizeSearchQuery(request.searchQuery, request.mode === 'search')
  const cursor = normalizeCursor(request.cursor)
  return {
    limit: normalizeLimit(request.limit),
    ...(searchQuery ? { searchQuery } : {}),
    ...(cursor ? { cursor } : {}),
  }
}

export async function fetchNetNvnArticlePage(
  request: NetNvnArticlePageRequest,
): Promise<NetNvnArticlePage> {
  const normalized = validatePageRequest(request)
  const { data, error } = await client().rpc('fetch_net_nvn_article_page', {
    requested_mode: request.mode,
    requested_category: request.category ?? null,
    requested_search_query: normalized.searchQuery ?? null,
    requested_cursor_at: normalized.cursor?.at ?? null,
    requested_cursor_id: normalized.cursor?.id ?? null,
    requested_limit: normalized.limit,
  })
  if (error) throw mapRpcError('NVN articles could not be loaded', error)
  if (!Array.isArray(data) || data.length > NET_NVN_PAGE_MAX_LIMIT) {
    return invalidResponse('The NVN page exceeded its bounded response contract.')
  }

  const rows = data.map((value) => {
    if (!isRecord(value) || typeof value.page_has_more !== 'boolean') {
      return invalidResponse('Invalid article page row returned by the NVN server.')
    }
    return { item: parseArticleSummary(value), hasMore: value.page_has_more }
  })
  const hasMore = rows[0]?.hasMore ?? false
  if (rows.some((row) => row.hasMore !== hasMore)) {
    return invalidResponse('Inconsistent NVN page continuation state returned by the server.')
  }
  const items = rows.map((row) => row.item)
  const lastItem = items.at(-1)
  return {
    items,
    hasMore,
    ...(hasMore && lastItem ? { nextCursor: { at: lastItem.pageSortAt, id: lastItem.id } } : {}),
  }
}

export async function fetchNetNvnArticle(articleId: string): Promise<NetNvnArticleDetail | null> {
  if (!UUID_PATTERN.test(articleId)) {
    throw new NetNvnRequestError('invalid-page-request', 'The NVN article reference is invalid.')
  }
  const { data, error } = await client().rpc('fetch_net_nvn_article', {
    requested_article_id: articleId,
  })
  if (error) throw mapRpcError('NVN article could not be opened', error)
  const row = firstRow(data)
  if (!row) return null
  const article = parseArticleDetail(row)
  // One batched signing request warms SharedMediaImage's shared cache. A media
  // signing failure must not make the plain-text article unreadable.
  prewarmSharedMediaUrls(article.media.map((item) => item.mediaRef))
  return article
}
