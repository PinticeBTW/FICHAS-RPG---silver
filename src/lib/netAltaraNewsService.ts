import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import { invalidateSharedMediaReference, prewarmSharedMediaUrls } from './media/mediaStorage'
import { parseNewsArticleMedia } from './newsArticleMedia'
import type {
  NetAltaraNewsArticleDetail,
  NetAltaraNewsArticleDraft,
  NetAltaraNewsArticleStatus,
  NetAltaraNewsArticleSummary,
  NetAltaraNewsCoverage,
  NetAltaraNewsCursor,
  NetAltaraNewsFeed,
  NetAltaraNewsFeedMode,
  NetAltaraNewsGmArticle,
  NetAltaraNewsGmArticleMediaInput,
  NetAltaraNewsGmArticleSummary,
  NetAltaraNewsGmIncident,
  NetAltaraNewsIncident,
  NetAltaraNewsIncidentDraft,
  NetAltaraNewsIncidentStatus,
  NetAltaraNewsIncidentUpdate,
  NetAltaraNewsLiveDesk,
  NetAltaraNewsPriority,
  NetAltaraNewsSection,
  NetAltaraNewsUpdateKind,
} from './netAltaraNewsTypes'
import {
  NET_ALTARA_NEWS_INLINE_MEDIA_MAX,
  NET_ALTARA_NEWS_MEDIA_ALT_MAX_LENGTH,
  NET_ALTARA_NEWS_MEDIA_CAPTION_MAX_LENGTH,
  NET_ALTARA_NEWS_MEDIA_MAX_TOTAL,
  NET_ALTARA_NEWS_MEDIA_REF_MAX_LENGTH,
} from './netAltaraNewsTypes'

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function row(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`NEWS returned an invalid ${label}.`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`NEWS returned an invalid ${label}.`)
  return value
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label)
  if (Number.isNaN(Date.parse(result))) throw new Error(`NEWS returned an invalid ${label}.`)
  return result
}

const sections = new Set<NetAltaraNewsSection>(['world', 'business', 'technology', 'culture'])
const coverage = new Set<NetAltaraNewsCoverage>(['world', 'local'])
const priorities = new Set<NetAltaraNewsPriority>(['standard', 'breaking'])
const articleStatuses = new Set<NetAltaraNewsArticleStatus>(['draft', 'published', 'archived'])
const incidentStatuses = new Set<NetAltaraNewsIncidentStatus>(['draft', 'live', 'closed', 'archived'])
const updateKinds = new Set<NetAltaraNewsUpdateKind>(['update', 'confirmation', 'warning', 'correction'])

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, label: string): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) throw new Error(`NEWS returned an invalid ${label}.`)
  return value as T
}

function parseSummary(value: unknown): NetAltaraNewsArticleSummary {
  const source = row(value, 'article summary')
  const reference = row(source.reference, 'article reference')
  if (source.featured !== true && source.featured !== false) throw new Error('NEWS returned invalid feature state.')
  if (source.saved !== true && source.saved !== false) throw new Error('NEWS returned invalid saved state.')
  if (reference.app_id !== 'altara-news') throw new Error('NEWS returned an invalid application reference.')
  return {
    articleId: text(source.article_id, 'article id'),
    slug: text(source.slug, 'article slug'),
    section: enumValue(source.section, sections, 'section'),
    coverageScope: enumValue(source.coverage_scope, coverage, 'coverage'),
    priority: enumValue(source.priority, priorities, 'priority'),
    headline: text(source.headline, 'headline'),
    ...(optionalText(source.deck) ? { deck: optionalText(source.deck) } : {}),
    authorLabel: text(source.author_label, 'author'),
    ...(optionalText(source.source_label) ? { sourceLabel: optionalText(source.source_label) } : {}),
    ...(optionalText(source.location_label) ? { locationLabel: optionalText(source.location_label) } : {}),
    featured: source.featured,
    publishedAt: timestamp(source.published_at, 'publication timestamp'),
    updatedAt: timestamp(source.updated_at, 'update timestamp'),
    saved: source.saved,
    reference: {
      appId: 'altara-news',
      articleId: text(reference.article_id, 'referenced article id'),
    },
    ...(source.status === 'published' || source.status === 'archived' ? { status: source.status } : {}),
    ...(source.archived_at ? { archivedAt: timestamp(source.archived_at, 'archive timestamp') } : {}),
  }
}

function parseCursor(value: unknown, atKey: string): NetAltaraNewsCursor | undefined {
  if (value === null || value === undefined) return undefined
  const source = row(value, 'page cursor')
  return { at: timestamp(source[atKey], 'cursor timestamp'), id: text(source.article_id, 'cursor id') }
}

function parseFeed(value: unknown): NetAltaraNewsFeed {
  const source = row(value, 'feed')
  if (!Array.isArray(source.articles)) throw new Error('NEWS returned an invalid feed list.')
  if (source.local_available !== true && source.local_available !== false) throw new Error('NEWS returned invalid local state.')
  const mode = source.mode
  if (!['home', 'local', 'world', 'business', 'technology', 'culture', 'saved', 'search', 'archive'].includes(String(mode))) {
    throw new Error('NEWS returned an invalid feed mode.')
  }
  const nextCursor = parseCursor(source.next_cursor, 'published_at')
  return {
    identityLinkId: text(source.identity_link_id, 'identity'),
    mode: mode as NetAltaraNewsFeedMode,
    ...(optionalText(source.local_label) ? { localLabel: optionalText(source.local_label) } : {}),
    localAvailable: source.local_available,
    articles: source.articles.map(parseSummary),
    ...(nextCursor ? { nextCursor } : {}),
  }
}

function parseUpdate(value: unknown): NetAltaraNewsIncidentUpdate {
  const source = row(value, 'live update')
  const sequence = Number(source.sequence)
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 100) throw new Error('NEWS returned an invalid update sequence.')
  return {
    updateId: text(source.update_id ?? source.id, 'update id'),
    sequence,
    updateKind: enumValue(source.update_kind, updateKinds, 'update kind'),
    body: text(source.body, 'update body'),
    publishedAt: timestamp(source.published_at, 'update timestamp'),
  }
}

function parseIncident(value: unknown, gm = false): NetAltaraNewsIncident | NetAltaraNewsGmIncident {
  const source = row(value, 'incident')
  if (!Array.isArray(source.updates)) throw new Error('NEWS returned invalid incident updates.')
  const incidentId = text(source.incident_id ?? source.id, 'incident id')
  const common = {
    incidentId,
    headline: text(source.headline, 'incident headline'),
    ...(optionalText(source.deck) ? { deck: optionalText(source.deck) } : {}),
    section: enumValue(source.section, sections, 'incident section'),
    coverageScope: enumValue(source.coverage_scope, coverage, 'incident coverage'),
    authorLabel: text(source.author_label, 'incident author'),
    ...(optionalText(source.source_label) ? { sourceLabel: optionalText(source.source_label) } : {}),
    ...(optionalText(source.location_label) ? { locationLabel: optionalText(source.location_label) } : {}),
    updatedAt: timestamp(source.updated_at, 'incident update timestamp'),
    updates: source.updates.map(parseUpdate),
  }
  if (!gm) return { ...common, startedAt: timestamp(source.started_at, 'incident start timestamp') }
  return {
    ...common,
    status: enumValue(source.status, incidentStatuses, 'incident status'),
    createdAt: timestamp(source.created_at, 'incident creation timestamp'),
    ...(source.started_at ? { startedAt: timestamp(source.started_at, 'incident start timestamp') } : {}),
    ...(source.closed_at ? { closedAt: timestamp(source.closed_at, 'incident close timestamp') } : {}),
    ...(source.archived_at ? { archivedAt: timestamp(source.archived_at, 'incident archive timestamp') } : {}),
    deck: optionalText(source.deck) ?? '',
    sourceLabel: optionalText(source.source_label) ?? '',
    locationLabel: optionalText(source.location_label) ?? '',
  }
}

function parseGmArticle(value: unknown): NetAltaraNewsGmArticle {
  const source = row(value, 'newsroom article')
  if (source.featured !== true && source.featured !== false) throw new Error('NEWS returned invalid feature state.')
  const media = parseNewsArticleMedia(source.media ?? [], (message) => { throw new Error(message) }, {
    productLabel: 'ALTARA NEWS',
    maxTotal: NET_ALTARA_NEWS_MEDIA_MAX_TOTAL,
    maxInline: NET_ALTARA_NEWS_INLINE_MEDIA_MAX,
    mediaRefMaxLength: NET_ALTARA_NEWS_MEDIA_REF_MAX_LENGTH,
    captionMaxLength: NET_ALTARA_NEWS_MEDIA_CAPTION_MAX_LENGTH,
    altTextMaxLength: NET_ALTARA_NEWS_MEDIA_ALT_MAX_LENGTH,
  })
  return {
    articleId: text(source.article_id ?? source.id, 'article id'),
    slug: text(source.slug, 'article slug'),
    status: enumValue(source.status, articleStatuses, 'article status'),
    section: enumValue(source.section, sections, 'article section'),
    coverageScope: enumValue(source.coverage_scope, coverage, 'article coverage'),
    priority: enumValue(source.priority, priorities, 'article priority'),
    headline: text(source.headline, 'article headline'),
    deck: optionalText(source.deck) ?? '',
    body: text(source.body, 'article body'),
    authorLabel: text(source.author_label, 'article author'),
    sourceLabel: optionalText(source.source_label) ?? '',
    locationLabel: optionalText(source.location_label) ?? '',
    featured: source.featured,
    createdAt: timestamp(source.created_at, 'article creation timestamp'),
    updatedAt: timestamp(source.updated_at, 'article update timestamp'),
    ...(source.published_at ? { publishedAt: timestamp(source.published_at, 'article publication timestamp') } : {}),
    ...(source.archived_at ? { archivedAt: timestamp(source.archived_at, 'article archive timestamp') } : {}),
    media,
  }
}

function warmGmArticleMedia(article: NetAltaraNewsGmArticle): NetAltaraNewsGmArticle {
  prewarmSharedMediaUrls(article.media.map((item) => item.mediaRef))
  return article
}

async function rpc<T>(name: string, args: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
  const { data, error } = await client().rpc(name, args)
  if (error) throw new Error(error.message)
  return parse(data)
}

export function fetchNetAltaraNewsFeed(
  identityId: string,
  mode: NetAltaraNewsFeedMode,
  cursor?: NetAltaraNewsCursor,
  filters: { readonly searchQuery?: string; readonly section?: NetAltaraNewsSection } = {},
) {
  return rpc('fetch_net_altara_news_article_page', {
    requested_expected_identity_link_id: identityId,
    requested_mode: mode,
    requested_search_query: filters.searchQuery ?? null,
    requested_section: filters.section ?? null,
    requested_cursor_at: cursor?.at ?? null,
    requested_cursor_id: cursor?.id ?? null,
    requested_limit: 20,
  }, parseFeed)
}

export function fetchNetAltaraNewsArticle(identityId: string, articleId: string) {
  return rpc('fetch_net_altara_news_article_record', {
    requested_expected_identity_link_id: identityId,
    requested_article_id: articleId,
  }, (value): NetAltaraNewsArticleDetail => {
    const source = row(value, 'article detail')
    const articleSource = row(source.article, 'article')
    if (!Array.isArray(source.related)) throw new Error('NEWS returned invalid related articles.')
    const media = parseNewsArticleMedia(source.media, (message) => { throw new Error(message) }, {
      productLabel: 'ALTARA NEWS',
      maxTotal: NET_ALTARA_NEWS_MEDIA_MAX_TOTAL,
      maxInline: NET_ALTARA_NEWS_INLINE_MEDIA_MAX,
      mediaRefMaxLength: NET_ALTARA_NEWS_MEDIA_REF_MAX_LENGTH,
      captionMaxLength: NET_ALTARA_NEWS_MEDIA_CAPTION_MAX_LENGTH,
      altTextMaxLength: NET_ALTARA_NEWS_MEDIA_ALT_MAX_LENGTH,
    })
    prewarmSharedMediaUrls(media.map((item) => item.mediaRef))
    return {
      article: { ...parseSummary(articleSource), body: text(articleSource.body, 'article body') },
      media,
      related: source.related.map(parseSummary),
    }
  })
}

export function fetchNetAltaraNewsLive(identityId: string) {
  return rpc('fetch_net_altara_news_live', {
    requested_expected_identity_link_id: identityId,
  }, (value): NetAltaraNewsLiveDesk => {
    const source = row(value, 'live desk')
    if (!Array.isArray(source.incidents)) throw new Error('NEWS returned invalid live incidents.')
    return {
      identityLinkId: text(source.identity_link_id, 'identity'),
      incidents: source.incidents.map((item) => parseIncident(item) as NetAltaraNewsIncident),
    }
  })
}

export function setNetAltaraNewsSaved(identityId: string, articleId: string, saved: boolean) {
  return rpc('set_net_altara_news_saved', {
    requested_expected_identity_link_id: identityId,
    requested_article_id: articleId,
    requested_saved: saved,
  }, (value) => {
    const source = row(value, 'save result')
    if (source.saved !== true && source.saved !== false) throw new Error('NEWS returned invalid saved state.')
    return { articleId: text(source.article_id, 'article id'), saved: source.saved }
  })
}

export function fetchNetAltaraNewsGmArticles(status: NetAltaraNewsArticleStatus | 'all' = 'all') {
  return rpc('fetch_net_altara_news_gm_articles', {
    requested_status: status,
    requested_cursor_at: null,
    requested_cursor_id: null,
    requested_limit: 40,
  }, (value): readonly NetAltaraNewsGmArticleSummary[] => {
    const source = row(value, 'newsroom directory')
    if (!Array.isArray(source.articles)) throw new Error('NEWS returned invalid newsroom articles.')
    return source.articles.map((item) => {
      const article = row(item, 'newsroom article summary')
      return {
        articleId: text(article.article_id, 'article id'),
        slug: text(article.slug, 'article slug'),
        status: enumValue(article.status, articleStatuses, 'article status'),
        section: enumValue(article.section, sections, 'article section'),
        coverageScope: enumValue(article.coverage_scope, coverage, 'article coverage'),
        priority: enumValue(article.priority, priorities, 'article priority'),
        headline: text(article.headline, 'article headline'),
        featured: article.featured === true,
        updatedAt: timestamp(article.updated_at, 'article update timestamp'),
        ...(article.published_at ? { publishedAt: timestamp(article.published_at, 'article publication timestamp') } : {}),
      }
    })
  })
}

export function fetchNetAltaraNewsGmArticle(articleId: string) {
  return rpc('fetch_net_altara_news_gm_article', { requested_article_id: articleId }, parseGmArticle)
    .then(warmGmArticleMedia)
}

export function saveNetAltaraNewsGmArticle(draft: NetAltaraNewsArticleDraft) {
  return rpc('save_net_altara_news_gm_article', {
    requested_article_id: draft.articleId ?? null,
    requested_slug: draft.slug,
    requested_section: draft.section,
    requested_coverage_scope: draft.coverageScope,
    requested_priority: draft.priority,
    requested_headline: draft.headline,
    requested_deck: draft.deck || null,
    requested_body: draft.body,
    requested_author_label: draft.authorLabel,
    requested_source_label: draft.sourceLabel || null,
    requested_location_label: draft.coverageScope === 'local' ? draft.locationLabel : null,
    requested_featured: draft.featured,
  }, parseGmArticle).then(warmGmArticleMedia)
}

export function setNetAltaraNewsGmArticleLifecycle(articleId: string, action: 'publish' | 'unpublish' | 'archive' | 'restore') {
  return rpc('set_net_altara_news_gm_article_lifecycle', {
    requested_article_id: articleId,
    requested_action: action,
  }, parseGmArticle).then(warmGmArticleMedia)
}

export async function setNetAltaraNewsGmArticleMedia(
  articleId: string,
  input: NetAltaraNewsGmArticleMediaInput,
  previousMediaRef?: string,
) {
  const result = await rpc('set_net_altara_news_gm_article_media', {
    requested_article_id: articleId,
    requested_media_id: input.mediaId ?? null,
    requested_placement_kind: input.placementKind,
    requested_media_ref: input.mediaRef,
    requested_caption: input.caption ?? null,
    requested_alt_text: input.altText,
    requested_paragraph_index: input.paragraphIndex ?? null,
  }, parseGmArticle)
  if (previousMediaRef && previousMediaRef !== input.mediaRef) {
    invalidateSharedMediaReference(previousMediaRef)
  }
  if (previousMediaRef !== input.mediaRef) invalidateSharedMediaReference(input.mediaRef)
  return warmGmArticleMedia(result)
}

export async function removeNetAltaraNewsGmArticleMedia(
  articleId: string,
  mediaId: string,
  removedMediaRef?: string,
) {
  const result = await rpc('remove_net_altara_news_gm_article_media', {
    requested_article_id: articleId,
    requested_media_id: mediaId,
  }, parseGmArticle)
  invalidateSharedMediaReference(removedMediaRef)
  return warmGmArticleMedia(result)
}

export function fetchNetAltaraNewsGmIncidents() {
  return rpc('fetch_net_altara_news_gm_incidents', {
    requested_status: 'all', requested_limit: 40,
  }, (value): readonly NetAltaraNewsGmIncident[] => {
    const source = row(value, 'incident directory')
    if (!Array.isArray(source.incidents)) throw new Error('NEWS returned invalid incident directory.')
    return source.incidents.map((item) => parseIncident(item, true) as NetAltaraNewsGmIncident)
  })
}

export function fetchNetAltaraNewsGmIncident(incidentId: string) {
  return rpc('fetch_net_altara_news_gm_incident', { requested_incident_id: incidentId },
    (value) => parseIncident(value, true) as NetAltaraNewsGmIncident)
}

export function saveNetAltaraNewsGmIncident(draft: NetAltaraNewsIncidentDraft) {
  return rpc('save_net_altara_news_gm_incident', {
    requested_incident_id: draft.incidentId ?? null,
    requested_section: draft.section,
    requested_coverage_scope: draft.coverageScope,
    requested_headline: draft.headline,
    requested_deck: draft.deck || null,
    requested_author_label: draft.authorLabel,
    requested_source_label: draft.sourceLabel || null,
    requested_location_label: draft.coverageScope === 'local' ? draft.locationLabel : null,
  }, (value) => parseIncident(value, true) as NetAltaraNewsGmIncident)
}

export function setNetAltaraNewsGmIncidentLifecycle(incidentId: string, action: 'start' | 'close' | 'archive' | 'restore') {
  return rpc('set_net_altara_news_gm_incident_lifecycle', {
    requested_incident_id: incidentId, requested_action: action,
  }, (value) => parseIncident(value, true) as NetAltaraNewsGmIncident)
}

export function appendNetAltaraNewsGmIncidentUpdate(incidentId: string, kind: NetAltaraNewsUpdateKind, body: string) {
  return rpc('append_net_altara_news_gm_incident_update', {
    requested_incident_id: incidentId,
    requested_update_kind: kind,
    requested_body: body,
  }, (value) => parseIncident(value, true) as NetAltaraNewsGmIncident)
}
