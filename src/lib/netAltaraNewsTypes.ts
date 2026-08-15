import type {
  NewsArticleMedia,
  NewsMediaPlacementKind,
  NewsroomArticleMediaInput,
} from './newsArticleMedia'

export const ALTARA_NEWS_APP_ID = 'altara-news' as const
export const ALTARA_NEWS_PRODUCT_NAME = 'NEWS'
export const NET_ALTARA_NEWS_MEDIA_MAX_TOTAL = 9
export const NET_ALTARA_NEWS_INLINE_MEDIA_MAX = 8
export const NET_ALTARA_NEWS_MEDIA_REF_MAX_LENGTH = 4096
export const NET_ALTARA_NEWS_MEDIA_CAPTION_MAX_LENGTH = 240
export const NET_ALTARA_NEWS_MEDIA_ALT_MAX_LENGTH = 300

export type NetAltaraNewsFeedMode =
  | 'home'
  | 'local'
  | 'world'
  | 'business'
  | 'technology'
  | 'culture'
  | 'saved'
  | 'search'
  | 'archive'

export type NetAltaraNewsSection = 'world' | 'business' | 'technology' | 'culture'
export type NetAltaraNewsCoverage = 'world' | 'local'
export type NetAltaraNewsPriority = 'standard' | 'breaking'
export type NetAltaraNewsArticleStatus = 'draft' | 'published' | 'archived'
export type NetAltaraNewsIncidentStatus = 'draft' | 'live' | 'closed' | 'archived'
export type NetAltaraNewsUpdateKind = 'update' | 'confirmation' | 'warning' | 'correction'
export type NetAltaraNewsMediaPlacementKind = NewsMediaPlacementKind
export type NetAltaraNewsArticleMedia = NewsArticleMedia
export type NetAltaraNewsGmArticleMediaInput = NewsroomArticleMediaInput

export interface NetAltaraNewsCursor {
  readonly at: string
  readonly id: string
}

export interface NetAltaraNewsArticleSummary {
  readonly articleId: string
  readonly slug: string
  readonly section: NetAltaraNewsSection
  readonly coverageScope: NetAltaraNewsCoverage
  readonly priority: NetAltaraNewsPriority
  readonly headline: string
  readonly deck?: string
  readonly authorLabel: string
  readonly sourceLabel?: string
  readonly locationLabel?: string
  readonly featured: boolean
  readonly publishedAt: string
  readonly updatedAt: string
  readonly saved: boolean
  readonly reference: { readonly appId: 'altara-news'; readonly articleId: string }
  readonly status?: 'published' | 'archived'
  readonly archivedAt?: string
}

export interface NetAltaraNewsFeed {
  readonly identityLinkId: string
  readonly mode: NetAltaraNewsFeedMode
  readonly localLabel?: string
  readonly localAvailable: boolean
  readonly articles: readonly NetAltaraNewsArticleSummary[]
  readonly nextCursor?: NetAltaraNewsCursor
}

export interface NetAltaraNewsArticleDetail {
  readonly article: NetAltaraNewsArticleSummary & { readonly body: string }
  readonly media: readonly NetAltaraNewsArticleMedia[]
  readonly related: readonly NetAltaraNewsArticleSummary[]
}

export interface NetAltaraNewsIncidentUpdate {
  readonly updateId: string
  readonly sequence: number
  readonly updateKind: NetAltaraNewsUpdateKind
  readonly body: string
  readonly publishedAt: string
}

export interface NetAltaraNewsIncident {
  readonly incidentId: string
  readonly headline: string
  readonly deck?: string
  readonly section: NetAltaraNewsSection
  readonly coverageScope: NetAltaraNewsCoverage
  readonly authorLabel: string
  readonly sourceLabel?: string
  readonly locationLabel?: string
  readonly startedAt: string
  readonly updatedAt: string
  readonly updates: readonly NetAltaraNewsIncidentUpdate[]
}

export interface NetAltaraNewsLiveDesk {
  readonly identityLinkId: string
  readonly incidents: readonly NetAltaraNewsIncident[]
}

export interface NetAltaraNewsArticleDraft {
  readonly articleId?: string
  readonly slug: string
  readonly section: NetAltaraNewsSection
  readonly coverageScope: NetAltaraNewsCoverage
  readonly priority: NetAltaraNewsPriority
  readonly headline: string
  readonly deck: string
  readonly body: string
  readonly authorLabel: string
  readonly sourceLabel: string
  readonly locationLabel: string
  readonly featured: boolean
}

export interface NetAltaraNewsGmArticleSummary {
  readonly articleId: string
  readonly slug: string
  readonly status: NetAltaraNewsArticleStatus
  readonly section: NetAltaraNewsSection
  readonly coverageScope: NetAltaraNewsCoverage
  readonly priority: NetAltaraNewsPriority
  readonly headline: string
  readonly featured: boolean
  readonly updatedAt: string
  readonly publishedAt?: string
}

export interface NetAltaraNewsGmArticle extends NetAltaraNewsArticleDraft {
  readonly articleId: string
  readonly status: NetAltaraNewsArticleStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly publishedAt?: string
  readonly archivedAt?: string
  readonly media: readonly NetAltaraNewsArticleMedia[]
}

export interface NetAltaraNewsIncidentDraft {
  readonly incidentId?: string
  readonly section: NetAltaraNewsSection
  readonly coverageScope: NetAltaraNewsCoverage
  readonly headline: string
  readonly deck: string
  readonly authorLabel: string
  readonly sourceLabel: string
  readonly locationLabel: string
}

export interface NetAltaraNewsGmIncident extends NetAltaraNewsIncidentDraft {
  readonly incidentId: string
  readonly status: NetAltaraNewsIncidentStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly startedAt?: string
  readonly closedAt?: string
  readonly archivedAt?: string
  readonly updates: readonly NetAltaraNewsIncidentUpdate[]
}

export type NetAltaraNewsRealtimeStatus = 'idle' | 'connecting' | 'subscribed' | 'disconnected'
