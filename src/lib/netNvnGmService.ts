import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import { invalidateSharedMediaReference, prewarmSharedMediaUrls } from './media/mediaStorage'
import { parseNetNvnArticleMedia } from './netNvnMediaContract'
import {
  NET_NVN_BODY_MAX_LENGTH,
  NET_NVN_BYLINE_NAME_MAX_LENGTH,
  NET_NVN_BYLINE_ROLE_MAX_LENGTH,
  NET_NVN_DISTRICT_LABEL_MAX_LENGTH,
  NET_NVN_GM_DIRECTORY_MAX_LIMIT,
  NET_NVN_HEADLINE_MAX_LENGTH,
  NET_NVN_LOCATION_LABEL_MAX_LENGTH,
  NET_NVN_PULL_QUOTE_ATTRIBUTION_MAX_LENGTH,
  NET_NVN_PULL_QUOTE_MAX_LENGTH,
  NET_NVN_REFERENCE_APP_MAX_LENGTH,
  NET_NVN_REFERENCE_ID_MAX_LENGTH,
  NET_NVN_REFERENCE_KIND_MAX_LENGTH,
  NET_NVN_SHORT_HEADLINE_MAX_LENGTH,
  NET_NVN_SLUG_MAX_LENGTH,
  NET_NVN_SOURCE_LABEL_MAX_ITEMS,
  NET_NVN_SOURCE_LABEL_MAX_LENGTH,
  NET_NVN_SUMMARY_MAX_LENGTH,
  NET_NVN_TAG_MAX_ITEMS,
  NET_NVN_TAG_MAX_LENGTH,
  NetNvnGmRequestError,
  netNvnArticleStatuses,
  netNvnBylineKinds,
  netNvnCategories,
  netNvnGmLifecycleActions,
  netNvnPriorities,
  netNvnSourceStatuses,
  netNvnStoryKinds,
  type NetNvnArticleStatus,
  type NetNvnBylineKind,
  type NetNvnCategory,
  type NetNvnGmArticleDetail,
  type NetNvnGmArticleDirectoryRow,
  type NetNvnGmArticleInput,
  type NetNvnGmArticleMediaInput,
  type NetNvnGmDirectoryFilter,
  type NetNvnGmLifecycleAction,
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
  if (!supabase) throw new NetNvnGmRequestError('request-failed', SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalidResponse(message: string): never {
  throw new NetNvnGmRequestError('invalid-server-response', message)
}

function requiredString(value: unknown, maximumLength: number, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength) {
    return invalidResponse(`Invalid ${label} returned by the NVN editor server.`)
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
    return invalidResponse(`Invalid ${label} returned by the NVN editor server.`)
  }
  return value as T[number]
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, 64, label)
  if (Number.isNaN(Date.parse(parsed))) {
    return invalidResponse(`Invalid ${label} returned by the NVN editor server.`)
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
    return invalidResponse(`Invalid ${label} returned by the NVN editor server.`)
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
    return invalidResponse(`Invalid ${label} returned by the NVN editor server.`)
  }
  return value.map((item) => requiredString(item, maximumItemLength, label))
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return isRecord(candidate) ? candidate : null
}

function mapError(prefix: string, error: SupabaseRpcErrorLike): NetNvnGmRequestError {
  if (
    error.code === '42501'
    || error.message.includes('authoritative GM')
    || error.message.includes('NVN newsroom')
  ) {
    return new NetNvnGmRequestError(
      'permission-denied',
      'Authoritative GM access is required for Newsroom Control.',
    )
  }
  if (error.message.includes('NVN_SLUG_TAKEN')) {
    return new NetNvnGmRequestError(
      'slug-taken',
      'That public story slug is already in use. Choose another.',
    )
  }
  if (error.message.includes('NVN_MEDIA_LIMIT_REACHED')) {
    return new NetNvnGmRequestError(
      'media-limit',
      'This article already uses the maximum of one hero and eight inline images.',
    )
  }
  if (error.message.includes('NVN_MEDIA_NOT_FOUND')) {
    return new NetNvnGmRequestError(
      'media-not-found',
      'This article image is no longer attached to the newsroom record.',
    )
  }
  if (
    error.message.includes('NVN_MEDIA_REFERENCE_INVALID')
    || error.message.includes('NVN_MEDIA_INPUT_INVALID')
  ) {
    return new NetNvnGmRequestError(
      'invalid-media',
      'The image metadata does not match the secure NVN media contract.',
    )
  }
  if (error.code === 'P0002' || error.message.includes('NVN_ARTICLE_NOT_FOUND')) {
    return new NetNvnGmRequestError(
      'article-not-found',
      'This newsroom article is no longer available.',
    )
  }
  if (error.message.includes('NVN_LIFECYCLE_INVALID')) {
    return new NetNvnGmRequestError(
      'invalid-lifecycle',
      'The article lifecycle changed before this action completed. Refresh and try again.',
    )
  }
  if (error.code === '22023' || error.message.includes('NVN_')) {
    return new NetNvnGmRequestError(
      'invalid-input',
      'One or more article fields do not match the NVN editorial contract.',
    )
  }
  return new NetNvnGmRequestError('request-failed', `${prefix}: ${error.message}`)
}

function parsePrimaryReference(row: Record<string, unknown>): NetNvnPrimaryReference | undefined {
  const appId = optionalString(
    row.primary_reference_app_id,
    NET_NVN_REFERENCE_APP_MAX_LENGTH,
    'reference application',
  )
  const resourceKind = optionalString(
    row.primary_reference_resource_kind,
    NET_NVN_REFERENCE_KIND_MAX_LENGTH,
    'reference kind',
  )
  const resourceId = optionalString(
    row.primary_reference_resource_id,
    NET_NVN_REFERENCE_ID_MAX_LENGTH,
    'reference id',
  )
  if (!appId && !resourceKind && !resourceId) return undefined
  if (!appId || !resourceKind || !resourceId) {
    return invalidResponse('Incomplete reference returned by the NVN editor server.')
  }
  return { appId, resourceKind, resourceId }
}

function parseDirectoryRow(row: Record<string, unknown>): NetNvnGmArticleDirectoryRow {
  const status = enumValue(row.status, netNvnArticleStatuses, 'article status') as NetNvnArticleStatus
  const shortHeadline = optionalString(
    row.short_headline,
    NET_NVN_SHORT_HEADLINE_MAX_LENGTH,
    'short headline',
  )
  const publishedAt = optionalTimestamp(row.published_at, 'publication timestamp')
  const archivedAt = optionalTimestamp(row.archived_at, 'archive timestamp')
  return {
    id: uuid(row.id, 'article id'),
    slug: requiredString(row.slug, NET_NVN_SLUG_MAX_LENGTH, 'article slug'),
    status,
    storyKind: enumValue(row.story_kind, netNvnStoryKinds, 'story kind') as NetNvnStoryKind,
    priority: enumValue(row.priority, netNvnPriorities, 'article priority') as NetNvnPriority,
    category: enumValue(row.category, netNvnCategories, 'article category') as NetNvnCategory,
    headline: requiredString(row.headline, NET_NVN_HEADLINE_MAX_LENGTH, 'headline'),
    ...(shortHeadline ? { shortHeadline } : {}),
    bylineName: requiredString(row.byline_name, NET_NVN_BYLINE_NAME_MAX_LENGTH, 'byline'),
    sourceStatus: enumValue(
      row.source_status,
      netNvnSourceStatuses,
      'source status',
    ) as NetNvnSourceStatus,
    updatedAt: timestamp(row.updated_at, 'update timestamp'),
    ...(publishedAt ? { publishedAt } : {}),
    ...(archivedAt ? { archivedAt } : {}),
  }
}

function parseDetail(row: Record<string, unknown>): NetNvnGmArticleDetail {
  const directory = parseDirectoryRow(row)
  const summary = optionalString(row.summary, NET_NVN_SUMMARY_MAX_LENGTH, 'summary')
  const bylineRole = optionalString(row.byline_role, NET_NVN_BYLINE_ROLE_MAX_LENGTH, 'byline role')
  const districtLabel = optionalString(
    row.district_label,
    NET_NVN_DISTRICT_LABEL_MAX_LENGTH,
    'district',
  )
  const locationLabel = optionalString(
    row.location_label,
    NET_NVN_LOCATION_LABEL_MAX_LENGTH,
    'location',
  )
  const occurredAt = optionalTimestamp(row.occurred_at, 'occurrence timestamp')
  const pullQuote = optionalString(row.pull_quote, NET_NVN_PULL_QUOTE_MAX_LENGTH, 'pull quote')
  const pullQuoteAttribution = optionalString(
    row.pull_quote_attribution,
    NET_NVN_PULL_QUOTE_ATTRIBUTION_MAX_LENGTH,
    'pull quote attribution',
  )
  if (Boolean(pullQuote) !== Boolean(pullQuoteAttribution)) {
    return invalidResponse('Incomplete pull quote returned by the NVN editor server.')
  }
  const primaryReference = parsePrimaryReference(row)
  const createdAt = timestamp(row.created_at, 'creation timestamp')
  const media = parseNetNvnArticleMedia(row.media, invalidResponse)
  if (
    (directory.status === 'draft' && (directory.publishedAt || directory.archivedAt))
    || (directory.status === 'published' && (!directory.publishedAt || directory.archivedAt))
    || (directory.status === 'archived' && (!directory.publishedAt || !directory.archivedAt))
  ) {
    return invalidResponse('Inconsistent article lifecycle returned by the NVN editor server.')
  }

  return {
    id: directory.id,
    slug: directory.slug,
    status: directory.status,
    storyKind: directory.storyKind,
    priority: directory.priority,
    category: directory.category,
    headline: directory.headline,
    ...(directory.shortHeadline ? { shortHeadline: directory.shortHeadline } : {}),
    ...(summary ? { summary } : {}),
    body: requiredString(row.body, NET_NVN_BODY_MAX_LENGTH, 'article body'),
    bylineName: directory.bylineName,
    ...(bylineRole ? { bylineRole } : {}),
    bylineKind: enumValue(row.byline_kind, netNvnBylineKinds, 'byline kind') as NetNvnBylineKind,
    sourceStatus: directory.sourceStatus,
    tags: textArray(row.tags, NET_NVN_TAG_MAX_ITEMS, NET_NVN_TAG_MAX_LENGTH, 'article tag'),
    sourceLabels: textArray(
      row.source_labels,
      NET_NVN_SOURCE_LABEL_MAX_ITEMS,
      NET_NVN_SOURCE_LABEL_MAX_LENGTH,
      'source label',
    ),
    ...(districtLabel ? { districtLabel } : {}),
    ...(locationLabel ? { locationLabel } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    ...(pullQuote ? { pullQuote, pullQuoteAttribution: pullQuoteAttribution! } : {}),
    ...(primaryReference ? { primaryReference } : {}),
    createdAt,
    updatedAt: directory.updatedAt,
    ...(directory.publishedAt ? { publishedAt: directory.publishedAt } : {}),
    ...(directory.archivedAt ? { archivedAt: directory.archivedAt } : {}),
    media,
  }
}

function parseAndWarmDetail(row: Record<string, unknown>): NetNvnGmArticleDetail {
  const detail = parseDetail(row)
  prewarmSharedMediaUrls(detail.media.map((item) => item.mediaRef))
  return detail
}

function articleArguments(input: NetNvnGmArticleInput) {
  return {
    requested_slug: input.slug,
    requested_story_kind: input.storyKind,
    requested_priority: input.priority,
    requested_category: input.category,
    requested_headline: input.headline,
    requested_short_headline: input.shortHeadline ?? null,
    requested_summary: input.summary ?? null,
    requested_body: input.body,
    requested_byline_name: input.bylineName,
    requested_byline_role: input.bylineRole ?? null,
    requested_byline_kind: input.bylineKind,
    requested_source_status: input.sourceStatus,
    requested_tags: [...input.tags],
    requested_source_labels: [...input.sourceLabels],
    requested_district_label: input.districtLabel ?? null,
    requested_location_label: input.locationLabel ?? null,
    requested_occurred_at: input.occurredAt ?? null,
    requested_pull_quote: input.pullQuote ?? null,
    requested_pull_quote_attribution: input.pullQuoteAttribution ?? null,
    requested_reference_app_id: input.primaryReference?.appId ?? null,
    requested_reference_resource_kind: input.primaryReference?.resourceKind ?? null,
    requested_reference_resource_id: input.primaryReference?.resourceId ?? null,
  }
}

export async function fetchNetNvnGmArticleDirectory(
  status: NetNvnGmDirectoryFilter = 'all',
  limit = NET_NVN_GM_DIRECTORY_MAX_LIMIT,
): Promise<readonly NetNvnGmArticleDirectoryRow[]> {
  if (status !== 'all' && !netNvnArticleStatuses.includes(status)) {
    throw new NetNvnGmRequestError('invalid-input', 'The newsroom directory filter is invalid.')
  }
  const boundedLimit = Math.min(
    Math.max(Number.isFinite(limit) ? Math.trunc(limit) : NET_NVN_GM_DIRECTORY_MAX_LIMIT, 1),
    NET_NVN_GM_DIRECTORY_MAX_LIMIT,
  )
  const { data, error } = await client().rpc('fetch_net_nvn_gm_article_directory', {
    requested_status: status,
    requested_limit: boundedLimit,
  })
  if (error) throw mapError('NVN newsroom directory could not be loaded', error)
  if (!Array.isArray(data) || data.length > NET_NVN_GM_DIRECTORY_MAX_LIMIT) {
    return invalidResponse('The NVN newsroom directory exceeded its bounded contract.')
  }
  return data.map((value) => {
    if (!isRecord(value)) return invalidResponse('Invalid NVN newsroom directory row.')
    return parseDirectoryRow(value)
  })
}

export async function fetchNetNvnGmArticle(
  articleId: string,
): Promise<NetNvnGmArticleDetail | null> {
  if (!UUID_PATTERN.test(articleId)) {
    throw new NetNvnGmRequestError('invalid-input', 'The article reference is invalid.')
  }
  const { data, error } = await client().rpc('fetch_net_nvn_gm_article', {
    requested_article_id: articleId,
  })
  if (error) throw mapError('NVN article could not be loaded for editing', error)
  const row = firstRow(data)
  return row ? parseAndWarmDetail(row) : null
}

export async function createNetNvnGmArticle(
  input: NetNvnGmArticleInput,
): Promise<NetNvnGmArticleDetail> {
  const { data, error } = await client().rpc('create_net_nvn_gm_article', articleArguments(input))
  if (error) throw mapError('NVN draft could not be created', error)
  const row = firstRow(data)
  if (!row) return invalidResponse('NVN draft creation returned no article.')
  return parseAndWarmDetail(row)
}

export async function updateNetNvnGmArticle(
  articleId: string,
  input: NetNvnGmArticleInput,
): Promise<NetNvnGmArticleDetail> {
  if (!UUID_PATTERN.test(articleId)) {
    throw new NetNvnGmRequestError('invalid-input', 'The article reference is invalid.')
  }
  const { data, error } = await client().rpc('update_net_nvn_gm_article', {
    requested_article_id: articleId,
    ...articleArguments(input),
  })
  if (error) throw mapError('NVN article could not be updated', error)
  const row = firstRow(data)
  if (!row) return invalidResponse('NVN article update returned no article.')
  return parseAndWarmDetail(row)
}

export async function setNetNvnGmArticleLifecycle(
  articleId: string,
  action: NetNvnGmLifecycleAction,
): Promise<NetNvnGmArticleDetail> {
  if (!UUID_PATTERN.test(articleId) || !netNvnGmLifecycleActions.includes(action)) {
    throw new NetNvnGmRequestError('invalid-input', 'The lifecycle request is invalid.')
  }
  const { data, error } = await client().rpc('set_net_nvn_gm_article_lifecycle', {
    requested_article_id: articleId,
    requested_action: action,
  })
  if (error) throw mapError('NVN lifecycle could not be changed', error)
  const row = firstRow(data)
  if (!row) return invalidResponse('NVN lifecycle update returned no article.')
  return parseAndWarmDetail(row)
}

export async function setNetNvnGmArticleMedia(
  articleId: string,
  input: NetNvnGmArticleMediaInput,
  previousMediaRef?: string,
): Promise<NetNvnGmArticleDetail> {
  if (!UUID_PATTERN.test(articleId) || (input.mediaId && !UUID_PATTERN.test(input.mediaId))) {
    throw new NetNvnGmRequestError('invalid-media', 'The image reference is invalid.')
  }
  const { data, error } = await client().rpc('set_net_nvn_gm_article_media', {
    requested_article_id: articleId,
    requested_media_id: input.mediaId ?? null,
    requested_placement_kind: input.placementKind,
    requested_media_ref: input.mediaRef,
    requested_caption: input.caption ?? null,
    requested_alt_text: input.altText,
    requested_paragraph_index: input.paragraphIndex ?? null,
  })
  if (error) throw mapError('NVN article image could not be saved', error)
  const row = firstRow(data)
  if (!row) return invalidResponse('NVN media update returned no article.')
  const descriptorChanged = previousMediaRef !== input.mediaRef
  if (previousMediaRef && descriptorChanged) {
    invalidateSharedMediaReference(previousMediaRef)
  }
  // Upload authorization exists before metadata attachment, while player read
  // authorization begins only after this successful RPC. Expire any earlier
  // denied/in-flight resolution before warming the newly authoritative row.
  if (descriptorChanged) invalidateSharedMediaReference(input.mediaRef)
  return parseAndWarmDetail(row)
}

export async function removeNetNvnGmArticleMedia(
  articleId: string,
  mediaId: string,
  removedMediaRef?: string,
): Promise<NetNvnGmArticleDetail> {
  if (!UUID_PATTERN.test(articleId) || !UUID_PATTERN.test(mediaId)) {
    throw new NetNvnGmRequestError('invalid-media', 'The image reference is invalid.')
  }
  const { data, error } = await client().rpc('remove_net_nvn_gm_article_media', {
    requested_article_id: articleId,
    requested_media_id: mediaId,
  })
  if (error) throw mapError('NVN article image could not be removed', error)
  const row = firstRow(data)
  if (!row) return invalidResponse('NVN media removal returned no article.')
  invalidateSharedMediaReference(removedMediaRef)
  return parseAndWarmDetail(row)
}
