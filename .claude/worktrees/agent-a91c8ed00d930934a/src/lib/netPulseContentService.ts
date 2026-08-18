import type { NetAppAccountStatus } from '../components/net/accounts/netAppAccountTypes'
import { normalizeNetHandle } from '../components/net/accounts/netAppAccountSelectors'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import { resolveSharedMediaUrls } from './media/mediaStorage'
import { isSharedMediaReference } from './media/mediaReference'
import {
  mapNetPulseRpcError,
  type NetPulseCompromisedRequestContext,
  type NetPulseRequestContext,
} from './netPulseRequestContext'

export const NET_PULSE_POST_MAX_LENGTH = 360
export const NET_PULSE_MENTION_MAX_ACCOUNTS = 10

export interface NetPulseMention {
  readonly accountId: string
  /** Normalized token as authored; presentation resolves the current handle. */
  readonly sourceHandle: string
  readonly currentHandle: string
}

export interface NetPulsePost {
  readonly id: string
  readonly authorAccountId: string
  readonly parentPostId?: string
  readonly body: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly replyCount: number
  readonly reactionCount: number
  readonly boostCount: number
  readonly viewerReacted: boolean
  readonly viewerBoosted: boolean
  readonly viewerBookmarked: boolean
  readonly viewerFollowsAuthor: boolean
  readonly followedBoosterAccountId?: string
  readonly followedBoosterHandle?: string
  readonly followingActivityAt: string
  readonly mentions: readonly NetPulseMention[]
}

export interface NetPulsePublicAuthor {
  readonly accountId: string
  readonly handle: string
  readonly displayName: string
  readonly avatarUrl?: string
  readonly status: NetAppAccountStatus
  readonly bio: string
  readonly visibility: 'public' | 'limited'
  readonly discoverable: boolean
  readonly followers: number
  readonly following: number
  readonly pulses: number
  readonly viewerFollowing: boolean
}

export interface NetPulseFeed {
  readonly posts: readonly NetPulsePost[]
  readonly authors: readonly NetPulsePublicAuthor[]
}

export type NetPulseContentQuery =
  | { readonly mode: 'city' | 'raw' | 'following' | 'bookmarks' | 'discover' }
  | { readonly mode: 'profile'; readonly accountId: string }
  | { readonly mode: 'search'; readonly query: string }
  | { readonly mode: 'thread'; readonly rootPostId: string }

export interface NetPulsePageCursor {
  readonly sortAt: string
  readonly id: string
}

export interface NetPulseContentPage {
  readonly feed: NetPulseFeed
  readonly nextCursor: NetPulsePageCursor | null
  readonly hasMore: boolean
}

interface NetPulseFeedRow {
  readonly id: string
  readonly author_account_id: string
  readonly parent_post_id: string | null
  readonly body: string
  readonly created_at: string
  readonly updated_at: string
  readonly author_handle: string
  readonly author_display_name: string
  readonly author_avatar_url: string | null
  readonly author_status: NetAppAccountStatus
  readonly author_bio: string | null
  readonly author_visibility: 'public' | 'limited'
  readonly author_discoverable: boolean
  readonly author_followers: number
  readonly author_following: number
  readonly author_pulses: number
  readonly viewer_follows_author: boolean
  readonly reply_count: number
  readonly reaction_count: number
  readonly boost_count: number
  readonly viewer_reacted: boolean
  readonly viewer_boosted: boolean
  readonly viewer_bookmarked: boolean
  readonly followed_booster_account_id: string | null
  readonly followed_booster_handle: string | null
  readonly following_activity_at: string
  readonly page_sort_at?: string
  readonly page_has_more?: boolean
  readonly is_thread_root?: boolean
}

interface NetPulsePostRow {
  readonly id: string
  readonly author_account_id: string
  readonly parent_post_id: string | null
  readonly body: string
  readonly created_at: string
  readonly updated_at: string
}

interface NetPulseMentionRow {
  readonly post_id: string
  readonly mentioned_account_id: string
  readonly source_handle: string
  readonly current_handle: string
}

function parseCount(value: unknown, label: string): number {
  const count = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid ${label} returned by the PULSE server.`)
  }
  return count
}

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parsePost(value: unknown): NetPulsePost {
  if (!isRecord(value)) throw new Error('Invalid PULSE post response.')
  const row = value as unknown as NetPulsePostRow
  const body = typeof row.body === 'string' ? row.body.trim() : ''

  if (
    typeof row.id !== 'string'
    || !row.id
    || typeof row.author_account_id !== 'string'
    || !row.author_account_id
    || !body
    || body.length > NET_PULSE_POST_MAX_LENGTH
    || typeof row.created_at !== 'string'
    || typeof row.updated_at !== 'string'
  ) {
    throw new Error('Invalid PULSE post fields returned by the server.')
  }

  return {
    id: row.id,
    authorAccountId: row.author_account_id,
    ...(typeof row.parent_post_id === 'string' && row.parent_post_id
      ? { parentPostId: row.parent_post_id }
      : {}),
    body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    replyCount: 'reply_count' in row ? parseCount(row.reply_count, 'reply count') : 0,
    reactionCount: 'reaction_count' in row ? parseCount(row.reaction_count, 'reaction count') : 0,
    boostCount: 'boost_count' in row ? parseCount(row.boost_count, 'boost count') : 0,
    viewerReacted: 'viewer_reacted' in row && row.viewer_reacted === true,
    viewerBoosted: 'viewer_boosted' in row && row.viewer_boosted === true,
    viewerBookmarked: 'viewer_bookmarked' in row && row.viewer_bookmarked === true,
    viewerFollowsAuthor: 'viewer_follows_author' in row && row.viewer_follows_author === true,
    ...('followed_booster_account_id' in row
      && typeof row.followed_booster_account_id === 'string'
      && row.followed_booster_account_id
      ? { followedBoosterAccountId: row.followed_booster_account_id }
      : {}),
    ...('followed_booster_handle' in row
      && typeof row.followed_booster_handle === 'string'
      && row.followed_booster_handle
      ? { followedBoosterHandle: row.followed_booster_handle }
      : {}),
    followingActivityAt: 'following_activity_at' in row
      && typeof row.following_activity_at === 'string'
      ? row.following_activity_at
      : row.created_at,
    mentions: [],
  }
}

function parseFeedRow(value: unknown): {
  readonly post: NetPulsePost
  readonly author: NetPulsePublicAuthor
} {
  if (!isRecord(value)) throw new Error('Invalid PULSE feed response.')
  const row = value as unknown as NetPulseFeedRow
  const normalizedHandle = typeof row.author_handle === 'string'
    ? normalizeNetHandle(row.author_handle)
    : undefined

  if (
    !normalizedHandle
    || typeof row.author_display_name !== 'string'
    || !row.author_display_name.trim()
    || !['active', 'suspended', 'disabled'].includes(row.author_status)
  ) {
    throw new Error('Invalid PULSE author fields returned by the server.')
  }

  return {
    post: parsePost(row),
    author: {
      accountId: row.author_account_id,
      handle: normalizedHandle,
      // PULSE is handle-first. The sheet-derived display name remains outside
      // the app and is never rendered as a second public PULSE username.
      displayName: `@${normalizedHandle}`,
      ...(typeof row.author_avatar_url === 'string' && row.author_avatar_url.trim()
        ? { avatarUrl: row.author_avatar_url.trim() }
        : {}),
      status: row.author_status,
      bio: typeof row.author_bio === 'string' ? row.author_bio : '',
      visibility: row.author_visibility === 'public' ? 'public' : 'limited',
      discoverable: row.author_discoverable === true,
      followers: parseCount(row.author_followers, 'follower count'),
      following: parseCount(row.author_following, 'following count'),
      pulses: parseCount(row.author_pulses, 'Pulse count'),
      viewerFollowing: row.viewer_follows_author === true,
    },
  }
}

function validateBody(body: string): string {
  const normalized = body.trim()
  if (!normalized) throw new Error('PULSE content cannot be empty.')
  if (normalized.length > NET_PULSE_POST_MAX_LENGTH) {
    throw new Error(`PULSE content is limited to ${NET_PULSE_POST_MAX_LENGTH} characters.`)
  }
  return normalized
}

function parseContentPage(data: unknown, thread = false): NetPulseContentPage {
  const rows = (data as unknown[] | null) ?? []
  const parsed = rows.map(parseFeedRow)
  const authorsById = new Map<string, NetPulsePublicAuthor>()
  for (const entry of parsed) authorsById.set(entry.author.accountId, entry.author)

  const cursorRows = rows.filter((row) => !thread || !(isRecord(row) && row.is_thread_root === true))
  const lastRow = cursorRows.at(-1)
  const nextCursor = isRecord(lastRow)
    && typeof lastRow.page_sort_at === 'string'
    && typeof lastRow.id === 'string'
    ? { sortAt: lastRow.page_sort_at, id: lastRow.id }
    : null

  return {
    feed: {
      posts: parsed.map((entry) => entry.post),
      authors: [...authorsById.values()],
    },
    nextCursor,
    hasMore: rows.some((row) => isRecord(row) && row.page_has_more === true),
  }
}

async function resolveContentPageMedia(page: NetPulseContentPage): Promise<NetPulseContentPage> {
  const references = page.feed.authors.map((author) => author.avatarUrl).filter(
    (value): value is string => Boolean(value && isSharedMediaReference(value)),
  )
  if (!references.length) return page
  try {
    const urls = await resolveSharedMediaUrls(references, 'thumbnail')
    return {
      ...page,
      feed: {
        ...page.feed,
        authors: page.feed.authors.map((author) => {
          if (!author.avatarUrl || !isSharedMediaReference(author.avatarUrl)) return author
          const avatarUrl = urls.get(author.avatarUrl)
          return avatarUrl ? { ...author, avatarUrl } : author
        }),
      },
    }
  } catch {
    return page
  }
}

function parseMentionRow(value: unknown): NetPulseMentionRow {
  if (!isRecord(value)) throw new Error('Invalid PULSE mention response.')
  const row = value as unknown as NetPulseMentionRow
  const sourceHandle = normalizeNetHandle(row.source_handle)
  const currentHandle = normalizeNetHandle(row.current_handle)
  if (
    typeof row.post_id !== 'string'
    || !row.post_id
    || typeof row.mentioned_account_id !== 'string'
    || !row.mentioned_account_id
    || !sourceHandle
    || !currentHandle
  ) {
    throw new Error('Invalid PULSE mention fields returned by the server.')
  }
  return {
    ...row,
    source_handle: sourceHandle,
    current_handle: currentHandle,
  }
}

async function resolveContentPageMentions(
  page: NetPulseContentPage,
  expectedAccountId: string | null,
): Promise<NetPulseContentPage> {
  const postIds = page.feed.posts.map((post) => post.id)
  if (!postIds.length) return page
  const { data, error } = await client().rpc('fetch_net_pulse_mentions_for_posts', {
    requested_post_ids: postIds,
    requested_expected_account_id: expectedAccountId,
  })
  if (error) {
    throw mapNetPulseRpcError('PULSE mentions could not be synchronized', error.message)
  }

  const mentionsByPostId = new Map<string, NetPulseMention[]>()
  for (const value of (data as unknown[] | null) ?? []) {
    const row = parseMentionRow(value)
    const mentions = mentionsByPostId.get(row.post_id) ?? []
    mentions.push({
      accountId: row.mentioned_account_id,
      sourceHandle: row.source_handle,
      currentHandle: row.current_handle,
    })
    mentionsByPostId.set(row.post_id, mentions)
  }
  return {
    ...page,
    feed: {
      ...page.feed,
      posts: page.feed.posts.map((post) => ({
        ...post,
        mentions: mentionsByPostId.get(post.id) ?? [],
      })),
    },
  }
}

async function hydrateContentPage(
  page: NetPulseContentPage,
  context: NetPulseRequestContext,
): Promise<NetPulseContentPage> {
  const [withMedia, withMentions] = await Promise.all([
    resolveContentPageMedia(page),
    resolveContentPageMentions(page, context.expectedAccountId),
  ])
  return {
    ...withMedia,
    feed: {
      ...withMedia.feed,
      posts: withMentions.feed.posts,
    },
  }
}

export function getNetPulseContentQueryKey(query: NetPulseContentQuery): string {
  switch (query.mode) {
    case 'profile': return `profile:${query.accountId}`
    case 'search': return `search:${query.query.trim().toLowerCase()}`
    case 'thread': return `thread:${query.rootPostId}`
    default: return query.mode
  }
}

/** One bounded cursor page with page-local author and engagement presentation. */
export async function fetchPulseContentPage(
  query: NetPulseContentQuery,
  cursor: NetPulsePageCursor | null = null,
  context: NetPulseRequestContext,
): Promise<NetPulseContentPage> {
  if (query.mode === 'thread') {
    const { data, error } = await client().rpc('fetch_net_pulse_thread_page', {
      requested_root_post_id: query.rootPostId,
      requested_cursor_at: cursor?.sortAt ?? null,
      requested_cursor_id: cursor?.id ?? null,
      requested_limit: 30,
      requested_expected_account_id: context.expectedAccountId,
    })
    if (error) throw mapNetPulseRpcError('PULSE thread could not be synchronized', error.message)
    return hydrateContentPage(parseContentPage(data, true), context)
  }

  const { data, error } = await client().rpc('fetch_net_pulse_page', {
    requested_mode: query.mode,
    requested_profile_account_id: query.mode === 'profile' ? query.accountId : null,
    requested_search_query: query.mode === 'search' ? query.query : null,
    requested_cursor_at: cursor?.sortAt ?? null,
    requested_cursor_id: cursor?.id ?? null,
    requested_limit: query.mode === 'discover' ? 16 : 20,
    requested_expected_account_id: context.expectedAccountId,
  })
  if (error) throw mapNetPulseRpcError(`PULSE ${query.mode} could not be synchronized`, error.message)
  return hydrateContentPage(parseContentPage(data), context)
}

/** Compatibility adapter retained for callers outside the paged PULSE shell. */
export async function fetchPulsePosts(
  context: NetPulseRequestContext,
  limit = 20,
): Promise<NetPulseFeed> {
  const page = await fetchPulseContentPage({ mode: 'city' }, null, context)
  return limit >= page.feed.posts.length
    ? page.feed
    : { ...page.feed, posts: page.feed.posts.slice(0, Math.max(1, Math.trunc(limit))) }
}

async function createPulseContent(input: {
  readonly authorAccountId: string
  readonly body: string
  readonly parentPostId?: string
}): Promise<NetPulsePost> {
  const authorAccountId = input.authorAccountId.trim()
  if (!authorAccountId) throw new Error('A PULSE author account is required.')

  const { data, error } = await client().rpc('create_net_pulse_post', {
    requested_body: validateBody(input.body),
    requested_parent_post_id: input.parentPostId ?? null,
    requested_expected_account_id: authorAccountId,
  })

  if (error) throw mapNetPulseRpcError('PULSE content could not be published', error.message)
  return parsePost(Array.isArray(data) ? data[0] : data)
}

/**
 * The compromised RPC accepts content only. Target identity, PULSE account,
 * action mode, actor, and audit basis are derived from the GM's server session.
 */
async function createCompromisedPulseContent(input: {
  readonly body: string
  readonly parentPostId?: string
  readonly context: NetPulseCompromisedRequestContext
}): Promise<NetPulsePost> {
  const { data, error } = await client().rpc('create_net_pulse_post_as_compromised_persona', {
    requested_body: validateBody(input.body),
    requested_parent_post_id: input.parentPostId ?? null,
    requested_expected_session_generation: input.context.expectedSessionGeneration,
    requested_expected_account_id: input.context.expectedAccountId,
  })

  if (error) {
    const contextError = mapNetPulseRpcError(
      'Compromised PULSE content could not be published',
      error.message,
    )
    if (contextError.name === 'NetPulseContextChangedError') throw contextError
    const message = error.message.includes('TARGET_HAS_NO_PULSE_ACCOUNT')
      ? 'The compromised identity has no PULSE account.'
      : error.message.includes('TARGET_PULSE_ACCOUNT_RESTRICTED')
        ? 'The compromised identity cannot currently publish on PULSE.'
        : error.message
    throw new Error(`Compromised PULSE content could not be published: ${message}`)
  }
  return parsePost(Array.isArray(data) ? data[0] : data)
}

export function createPulsePost(input: {
  readonly authorAccountId: string
  readonly body: string
}): Promise<NetPulsePost> {
  return createPulseContent(input)
}

export function createPulseReply(input: {
  readonly authorAccountId: string
  readonly parentPostId: string
  readonly body: string
}): Promise<NetPulsePost> {
  const parentPostId = input.parentPostId.trim()
  if (!parentPostId) throw new Error('A server-backed parent PULSE is required.')
  return createPulseContent({ ...input, parentPostId })
}

export function createCompromisedPulsePost(input: {
  readonly body: string
  readonly context: NetPulseCompromisedRequestContext
}): Promise<NetPulsePost> {
  return createCompromisedPulseContent(input)
}

export function createCompromisedPulseReply(input: {
  readonly parentPostId: string
  readonly body: string
  readonly context: NetPulseCompromisedRequestContext
}): Promise<NetPulsePost> {
  const parentPostId = input.parentPostId.trim()
  if (!parentPostId) throw new Error('A server-backed parent PULSE is required.')
  return createCompromisedPulseContent({ ...input, parentPostId })
}

/**
 * Presentation may hide the action after ten minutes, but the database clock is
 * the only deletion-window authority. No author or action-mode claim is sent.
 */
export async function deletePulsePost(postId: string, expectedAccountId: string): Promise<string> {
  const normalizedPostId = postId.trim()
  if (!normalizedPostId) throw new Error('A server-backed PULSE is required.')
  const { data, error } = await client().rpc('delete_net_pulse_post', {
    requested_post_id: normalizedPostId,
    requested_expected_account_id: expectedAccountId,
  })

  if (error) throw mapNetPulseRpcError('PULSE could not be deleted', error.message)
  const deletedId = Array.isArray(data) ? data[0] : data
  if (typeof deletedId !== 'string' || !deletedId) {
    throw new Error('PULSE deletion returned an invalid response.')
  }
  return deletedId
}

/** Target account and compromised authority are derived from the GM session. */
export async function deletePulsePostAsCompromised(
  postId: string,
  context: NetPulseCompromisedRequestContext,
): Promise<string> {
  const normalizedPostId = postId.trim()
  if (!normalizedPostId) throw new Error('A server-backed PULSE is required.')
  const { data, error } = await client().rpc('delete_net_pulse_post_as_compromised_persona', {
    requested_post_id: normalizedPostId,
    requested_expected_session_generation: context.expectedSessionGeneration,
    requested_expected_account_id: context.expectedAccountId,
  })

  if (error) throw mapNetPulseRpcError('Compromised PULSE could not be deleted', error.message)
  const deletedId = Array.isArray(data) ? data[0] : data
  if (typeof deletedId !== 'string' || !deletedId) {
    throw new Error('Compromised PULSE deletion returned an invalid response.')
  }
  return deletedId
}
