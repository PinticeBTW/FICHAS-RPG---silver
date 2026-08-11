export const NET_NVN_PAGE_DEFAULT_LIMIT = 20
export const NET_NVN_PAGE_MAX_LIMIT = 40
export const NET_NVN_SEARCH_MIN_LENGTH = 3
export const NET_NVN_SEARCH_MAX_LENGTH = 80

export const NET_NVN_SLUG_MAX_LENGTH = 100
export const NET_NVN_HEADLINE_MAX_LENGTH = 180
export const NET_NVN_SHORT_HEADLINE_MAX_LENGTH = 100
export const NET_NVN_SUMMARY_MAX_LENGTH = 400
export const NET_NVN_BODY_MAX_LENGTH = 12000
export const NET_NVN_BYLINE_NAME_MAX_LENGTH = 100
export const NET_NVN_BYLINE_ROLE_MAX_LENGTH = 100
export const NET_NVN_TAG_MAX_ITEMS = 12
export const NET_NVN_TAG_MAX_LENGTH = 40
export const NET_NVN_SOURCE_LABEL_MAX_ITEMS = 12
export const NET_NVN_SOURCE_LABEL_MAX_LENGTH = 120
export const NET_NVN_DISTRICT_LABEL_MAX_LENGTH = 120
export const NET_NVN_LOCATION_LABEL_MAX_LENGTH = 120
export const NET_NVN_PULL_QUOTE_MAX_LENGTH = 600
export const NET_NVN_PULL_QUOTE_ATTRIBUTION_MAX_LENGTH = 160
export const NET_NVN_REFERENCE_APP_MAX_LENGTH = 32
export const NET_NVN_REFERENCE_KIND_MAX_LENGTH = 40
export const NET_NVN_REFERENCE_ID_MAX_LENGTH = 160
export const NET_NVN_GM_DIRECTORY_MAX_LIMIT = 200
export const NET_NVN_MEDIA_MAX_TOTAL = 9
export const NET_NVN_INLINE_MEDIA_MAX = 8
export const NET_NVN_MEDIA_REF_MAX_LENGTH = 4096
export const NET_NVN_MEDIA_CAPTION_MAX_LENGTH = 400
export const NET_NVN_MEDIA_ALT_MAX_LENGTH = 300

export const netNvnArticleStatuses = ['draft', 'published', 'archived'] as const
export const netNvnPlayerArticleStatuses = ['published', 'archived'] as const
export const netNvnStoryKinds = ['report', 'investigation', 'opinion'] as const
export const netNvnPriorities = ['standard', 'breaking'] as const
export const netNvnCategories = [
  'new-vega',
  'world',
  'business',
  'technology',
  'culture',
  'opinion',
] as const
export const netNvnBylineKinds = ['reporter', 'desk', 'editorial', 'protected'] as const
export const netNvnSourceStatuses = [
  'verified',
  'multiple-sources',
  'official-statement',
  'developing',
  'protected-source',
  'unconfirmed',
] as const
export const netNvnArticlePageModes = ['home', 'category', 'search', 'archive'] as const
export const netNvnGmLifecycleActions = ['publish', 'hide', 'archive', 'restore'] as const
export const netNvnMediaPlacementKinds = ['hero', 'inline'] as const

export type NetNvnArticleStatus = typeof netNvnArticleStatuses[number]
export type NetNvnPlayerArticleStatus = typeof netNvnPlayerArticleStatuses[number]
export type NetNvnStoryKind = typeof netNvnStoryKinds[number]
export type NetNvnPriority = typeof netNvnPriorities[number]
export type NetNvnCategory = typeof netNvnCategories[number]
export type NetNvnBylineKind = typeof netNvnBylineKinds[number]
export type NetNvnSourceStatus = typeof netNvnSourceStatuses[number]
export type NetNvnArticlePageMode = typeof netNvnArticlePageModes[number]
export type NetNvnGmLifecycleAction = typeof netNvnGmLifecycleActions[number]
export type NetNvnMediaPlacementKind = typeof netNvnMediaPlacementKinds[number]
export type NetNvnGmDirectoryFilter = 'all' | NetNvnArticleStatus

export interface NetNvnArticleCursor {
  readonly at: string
  readonly id: string
}

export interface NetNvnPrimaryReference {
  readonly appId: string
  readonly resourceKind: string
  readonly resourceId: string
}

export interface NetNvnArticleMedia {
  readonly id: string
  readonly placementKind: NetNvnMediaPlacementKind
  readonly mediaRef: string
  readonly caption?: string
  readonly altText: string
  /** Zero-based paragraph index. Inline media renders after this paragraph. */
  readonly paragraphIndex?: number
  readonly sortOrder: number
}

export interface NetNvnGmArticleMediaInput {
  readonly mediaId?: string
  readonly placementKind: NetNvnMediaPlacementKind
  readonly mediaRef: string
  readonly caption?: string
  readonly altText: string
  /** Zero-based paragraph index. Required for inline media, absent for hero. */
  readonly paragraphIndex?: number
}

export interface NetNvnArticlePublicMetadata {
  readonly id: string
  readonly slug: string
  readonly status: NetNvnPlayerArticleStatus
  readonly headline: string
  readonly shortHeadline?: string
  readonly summary?: string
  readonly storyKind: NetNvnStoryKind
  readonly priority: NetNvnPriority
  readonly category: NetNvnCategory
  readonly bylineName: string
  readonly bylineRole?: string
  readonly bylineKind: NetNvnBylineKind
  readonly sourceStatus: NetNvnSourceStatus
  readonly tags: readonly string[]
  readonly districtLabel?: string
  readonly locationLabel?: string
  readonly occurredAt?: string
  readonly publishedAt: string
  readonly updatedAt: string
  readonly archivedAt?: string
}

export interface NetNvnArticleSummary extends NetNvnArticlePublicMetadata {
  readonly pageSortAt: string
}

export interface NetNvnArticleDetail extends NetNvnArticlePublicMetadata {
  readonly body: string
  readonly sourceLabels: readonly string[]
  readonly pullQuote?: string
  readonly pullQuoteAttribution?: string
  readonly primaryReference?: NetNvnPrimaryReference
  readonly media: readonly NetNvnArticleMedia[]
}

export interface NetNvnArticlePage {
  readonly items: readonly NetNvnArticleSummary[]
  readonly hasMore: boolean
  readonly nextCursor?: NetNvnArticleCursor
}

export interface NetNvnArticlePageRequest {
  readonly mode: NetNvnArticlePageMode
  readonly category?: NetNvnCategory
  readonly searchQuery?: string
  readonly cursor?: NetNvnArticleCursor
  readonly limit?: number
}

export interface NetNvnGmArticleDirectoryRow {
  readonly id: string
  readonly slug: string
  readonly status: NetNvnArticleStatus
  readonly storyKind: NetNvnStoryKind
  readonly priority: NetNvnPriority
  readonly category: NetNvnCategory
  readonly headline: string
  readonly shortHeadline?: string
  readonly bylineName: string
  readonly sourceStatus: NetNvnSourceStatus
  readonly updatedAt: string
  readonly publishedAt?: string
  readonly archivedAt?: string
}

export interface NetNvnGmArticleInput {
  readonly slug: string
  readonly storyKind: NetNvnStoryKind
  readonly priority: NetNvnPriority
  readonly category: NetNvnCategory
  readonly headline: string
  readonly shortHeadline?: string
  readonly summary?: string
  readonly body: string
  readonly bylineName: string
  readonly bylineRole?: string
  readonly bylineKind: NetNvnBylineKind
  readonly sourceStatus: NetNvnSourceStatus
  readonly tags: readonly string[]
  readonly sourceLabels: readonly string[]
  readonly districtLabel?: string
  readonly locationLabel?: string
  readonly occurredAt?: string
  readonly pullQuote?: string
  readonly pullQuoteAttribution?: string
  readonly primaryReference?: NetNvnPrimaryReference
}

export interface NetNvnGmArticleDetail extends NetNvnGmArticleInput {
  readonly id: string
  readonly status: NetNvnArticleStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly publishedAt?: string
  readonly archivedAt?: string
  readonly media: readonly NetNvnArticleMedia[]
}

export type NetNvnGmRequestErrorCode =
  | 'permission-denied'
  | 'slug-taken'
  | 'article-not-found'
  | 'invalid-lifecycle'
  | 'invalid-input'
  | 'media-limit'
  | 'media-not-found'
  | 'invalid-media'
  | 'invalid-server-response'
  | 'request-failed'

export class NetNvnGmRequestError extends Error {
  readonly code: NetNvnGmRequestErrorCode

  constructor(code: NetNvnGmRequestErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NetNvnGmRequestError'
    this.code = code
  }
}

export function isNetNvnGmRequestError(error: unknown): error is NetNvnGmRequestError {
  return error instanceof NetNvnGmRequestError
}

export type NetNvnRequestErrorCode =
  | 'authentication-required'
  | 'invalid-page-request'
  | 'invalid-search-query'
  | 'invalid-server-response'
  | 'request-failed'

export class NetNvnRequestError extends Error {
  readonly code: NetNvnRequestErrorCode

  constructor(code: NetNvnRequestErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NetNvnRequestError'
    this.code = code
  }
}

export function isNetNvnRequestError(error: unknown): error is NetNvnRequestError {
  return error instanceof NetNvnRequestError
}
