export const NET_SEARCH_QUERY_MIN_LENGTH = 2
export const NET_SEARCH_QUERY_MAX_LENGTH = 120
export const NET_SEARCH_RESULT_DEFAULT_LIMIT = 20
export const NET_SEARCH_RESULT_MAX_LIMIT = 30
export const NET_SEARCH_GM_DIRECTORY_MAX_LIMIT = 200

export const NET_SEARCH_TITLE_MAX_LENGTH = 160
export const NET_SEARCH_SUMMARY_MAX_LENGTH = 500
export const NET_SEARCH_CONTENT_MAX_LENGTH = 20_000
export const NET_SEARCH_ALIAS_MAX_ITEMS = 20
export const NET_SEARCH_ALIAS_MAX_LENGTH = 100
export const NET_SEARCH_TAG_MAX_ITEMS = 20
export const NET_SEARCH_TAG_MAX_LENGTH = 60
export const NET_SEARCH_REFERENCE_MAX_ITEMS = 20
export const NET_SEARCH_REFERENCE_MAX_LENGTH = 160

export const netSearchEntryTypes = [
  'person',
  'organization',
  'location',
  'event',
  'technology',
  'concept',
  'project',
  'document',
  'other',
] as const

export const netSearchVisibilities = ['public', 'restricted', 'classified'] as const
export const netSearchEntryStatuses = ['active', 'archived'] as const
export const netSearchGmLifecycleFilters = [
  'all',
  'current',
  'future',
  'expired',
  'archived',
] as const

export type NetSearchEntryType = typeof netSearchEntryTypes[number]
export type NetSearchVisibility = typeof netSearchVisibilities[number]
export type NetSearchEntryStatus = typeof netSearchEntryStatuses[number]
export type NetSearchGmLifecycleFilter = typeof netSearchGmLifecycleFilters[number]

export interface NetSearchResult {
  readonly id: string
  readonly sourceKind: 'knowledge'
  readonly entryType: NetSearchEntryType
  readonly title: string
  readonly summary: string
  readonly excerpt: string
  readonly tags: readonly string[]
  readonly updatedAt: string
  readonly score: number
}

export interface NetSearchEntryDetail extends NetSearchResult {
  readonly content: string
  readonly aliases: readonly string[]
  readonly relatedReferences: readonly string[]
  readonly availableFrom?: string
  readonly expiresAt?: string
}

export interface NetSearchGmDirectoryRow {
  readonly id: string
  readonly title: string
  readonly entryType: NetSearchEntryType
  readonly visibility: NetSearchVisibility
  readonly status: NetSearchEntryStatus
  readonly availableFrom?: string
  readonly expiresAt?: string
  readonly updatedAt: string
}

export interface NetSearchGmEntryInput {
  readonly title: string
  readonly entryType: NetSearchEntryType
  readonly summary: string
  readonly content: string
  readonly aliases: readonly string[]
  readonly tags: readonly string[]
  readonly visibility: NetSearchVisibility
  readonly availableFrom?: string
  readonly expiresAt?: string
  readonly relatedReferences: readonly string[]
}

export interface NetSearchGmEntryDetail extends NetSearchGmEntryInput {
  readonly id: string
  readonly status: NetSearchEntryStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly archivedAt?: string
}

export type NetSearchRequestErrorCode =
  | 'authentication-required'
  | 'permission-denied'
  | 'invalid-query'
  | 'invalid-input'
  | 'entry-not-found'
  | 'invalid-lifecycle'
  | 'invalid-server-response'
  | 'request-failed'

export class NetSearchRequestError extends Error {
  readonly code: NetSearchRequestErrorCode

  constructor(code: NetSearchRequestErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NetSearchRequestError'
    this.code = code
  }
}

export function isNetSearchRequestError(error: unknown): error is NetSearchRequestError {
  return error instanceof NetSearchRequestError
}
