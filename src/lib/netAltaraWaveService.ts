import { normalizeNetHandle } from '../components/net/accounts/netAppAccountSelectors'
import { resolveSharedMediaUrls } from './media/mediaStorage'
import { isSharedMediaReference } from './media/mediaReference'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import {
  NET_ALTARA_WAVE_BIO_MAX_LENGTH,
  NET_ALTARA_WAVE_HANDLE_MAX_LENGTH,
  NET_ALTARA_WAVE_POST_MAX_LENGTH,
  NetAltaraWaveContextChangedError,
  type NetAltaraWaveAccount,
  type NetAltaraWaveFeedMode,
  type NetAltaraWaveNotification,
  type NetAltaraWaveNotificationPage,
  type NetAltaraWavePageCursor,
  type NetAltaraWavePost,
  type NetAltaraWavePostPage,
  type NetAltaraWaveProfileInput,
  type NetAltaraWaveRelationshipPage,
  type NetAltaraWaveSession,
  type NetAltaraWaveThreadPage,
} from './netAltaraWaveTypes'

const PAGE_SIZE = 20
const MAX_PAGE_SIZE = 40

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid WAVE ${label}.`)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function countValue(value: unknown, label: string): number {
  const count = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid WAVE ${label}.`)
  return count
}

function mapWaveError(prefix: string, message: string): Error {
  if (/CONTEXT_CHANGED|RUNTIME_IDENTITY_CONTEXT_CHANGED|RUNTIME_CONTROL_REQUIRED/.test(message)) {
    return new NetAltaraWaveContextChangedError()
  }
  const known: readonly [RegExp, string][] = [
    [/ALTARA_WAVE_HANDLE_TAKEN/, 'That WAVE handle is already in use.'],
    [/ALTARA_WAVE_HANDLE_INVALID/, 'Use 2–32 letters, numbers, periods, underscores, or hyphens.'],
    [/NET_RUNTIME_APP_NOT_INSTALLED/, 'WAVE is not installed for this identity.'],
    [/NET_OS_SERVICE_ACCESS_DENIED/, 'This identity is not eligible for WAVE on its current OS.'],
    [/ALTARA_WAVE_RATE_LIMIT/, 'WAVE is receiving too many actions. Wait a moment and try again.'],
    [/ALTARA_WAVE_OWNED_MEDIA_DISABLED/, 'WAVE is text-first. New profile and post images are no longer accepted.'],
    [/ALTARA_WAVE_ACCOUNT_REQUIRED/, 'Create a WAVE profile before using the network.'],
    [/ALTARA_WAVE_POST_NOT_AVAILABLE/, 'That post is no longer available.'],
  ]
  return new Error(`${prefix}: ${known.find(([pattern]) => pattern.test(message))?.[1] ?? message}`)
}

function parseAccount(value: unknown): NetAltaraWaveAccount {
  if (!isRecord(value)) throw new Error('Invalid WAVE account response.')
  const handle = normalizeNetHandle(typeof value.handle === 'string' ? value.handle : '')
  const status = value.status
  const legacyAvatarRef = optionalString(value.avatar_ref)
  const effectiveAvatarRef = Object.hasOwn(value, 'effective_avatar_ref')
    ? optionalString(value.effective_avatar_ref)
    : legacyAvatarRef
  const avatarOverrideRef = Object.hasOwn(value, 'avatar_override_ref')
    ? optionalString(value.avatar_override_ref)
    : legacyAvatarRef
  if (
    !handle
    || typeof value.id !== 'string'
    || typeof value.identity_link_id !== 'string'
    || typeof value.display_name !== 'string'
    || !['active', 'suspended', 'disabled'].includes(String(status))
    || typeof value.joined_at !== 'string'
    || typeof value.updated_at !== 'string'
  ) throw new Error('Invalid WAVE account fields returned by the server.')
  return {
    id: value.id,
    identityLinkId: value.identity_link_id,
    handle,
    displayName: value.display_name,
    bio: typeof value.bio === 'string' ? value.bio : '',
    ...(effectiveAvatarRef ? { avatarRef: effectiveAvatarRef } : {}),
    ...(avatarOverrideRef ? { avatarOverrideRef } : {}),
    ...(optionalString(value.banner_ref) ? { bannerRef: optionalString(value.banner_ref) } : {}),
    ...(optionalString(value.location_label) ? { location: optionalString(value.location_label) } : {}),
    ...(optionalString(value.website_url) ? { websiteUrl: optionalString(value.website_url) } : {}),
    status: status as NetAltaraWaveAccount['status'],
    joinedAt: value.joined_at,
    updatedAt: value.updated_at,
    followersCount: countValue(value.followers_count ?? 0, 'follower count'),
    followingCount: countValue(value.following_count ?? 0, 'following count'),
    postsCount: countValue(value.posts_count ?? 0, 'post count'),
    viewerFollowing: value.viewer_following === true,
    viewerOwns: value.viewer_owns === true,
  }
}

function parsePost(value: unknown): NetAltaraWavePost {
  if (!isRecord(value)) throw new Error('Invalid WAVE post response.')
  const author = parseAccount(value.author)
  const deleted = value.deleted === true
  if (
    typeof value.id !== 'string'
    || typeof value.author_account_id !== 'string'
    || typeof value.body !== 'string'
    || (!deleted && !value.body.trim() && !optionalString(value.media_ref))
    || typeof value.created_at !== 'string'
    || typeof value.updated_at !== 'string'
    || typeof value.activity_at !== 'string'
  ) throw new Error('Invalid WAVE post fields returned by the server.')
  const mentionRows = Array.isArray(value.mentions) ? value.mentions : []
  return {
    id: value.id,
    authorAccountId: value.author_account_id,
    ...(optionalString(value.parent_post_id) ? { parentPostId: optionalString(value.parent_post_id) } : {}),
    ...(optionalString(value.root_post_id) ? { rootPostId: optionalString(value.root_post_id) } : {}),
    body: value.body,
    ...(optionalString(value.media_ref) ? { mediaRef: optionalString(value.media_ref) } : {}),
    deleted,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    activityAt: value.activity_at,
    replyCount: countValue(value.reply_count ?? 0, 'reply count'),
    reactionCount: countValue(value.reaction_count ?? 0, 'reaction count'),
    boostCount: countValue(value.boost_count ?? 0, 'boost count'),
    viewerReacted: value.viewer_reacted === true,
    viewerBoosted: value.viewer_boosted === true,
    viewerBookmarked: value.viewer_bookmarked === true,
    ...(isRecord(value.boosted_by) ? {
      boostedBy: {
        id: stringValue(value.boosted_by.id, 'boost account'),
        handle: stringValue(value.boosted_by.handle, 'boost handle'),
        displayName: stringValue(value.boosted_by.display_name, 'boost display name'),
      },
    } : {}),
    mentions: mentionRows.flatMap((entry) => {
      if (!isRecord(entry)) return []
      const sourceHandle = normalizeNetHandle(typeof entry.source_handle === 'string' ? entry.source_handle : '')
      const currentHandle = normalizeNetHandle(typeof entry.current_handle === 'string' ? entry.current_handle : '')
      return sourceHandle && currentHandle && typeof entry.account_id === 'string'
        ? [{ accountId: entry.account_id, sourceHandle, currentHandle }]
        : []
    }),
    author,
  }
}

async function hydrateMedia<T extends {
  readonly accounts?: readonly NetAltaraWaveAccount[]
  readonly posts?: readonly NetAltaraWavePost[]
}>(value: T): Promise<T> {
  const accounts = new Map<string, NetAltaraWaveAccount>()
  for (const account of value.accounts ?? []) accounts.set(account.id, account)
  for (const post of value.posts ?? []) accounts.set(post.author.id, post.author)
  const thumbnailRefs = [...accounts.values()].map((account) => account.avatarRef).filter(
    (entry): entry is string => Boolean(entry && isSharedMediaReference(entry)),
  )
  const displayRefs = [
    ...(value.posts ?? []).map((post) => post.mediaRef),
  ].filter((entry): entry is string => Boolean(entry && isSharedMediaReference(entry)))
  // Prime the shared descriptor/path cache in two bounded Storage requests.
  // Keep the authoritative descriptors in the model: profile saves must send
  // the original rpg-media:v1 value, never a temporary signed URL.
  await Promise.all([
    resolveSharedMediaUrls(thumbnailRefs, 'thumbnail'),
    resolveSharedMediaUrls(displayRefs, 'display'),
  ])
  return value
}

function parseCursor(value: unknown): NetAltaraWavePageCursor | null {
  return isRecord(value) && typeof value.sort_at === 'string' && typeof value.id === 'string'
    ? { sortAt: value.sort_at, id: value.id }
    : null
}

function validateProfile(input: NetAltaraWaveProfileInput): NetAltaraWaveProfileInput {
  const handle = normalizeNetHandle(input.handle)
  if (!handle || handle.length > NET_ALTARA_WAVE_HANDLE_MAX_LENGTH) {
    throw new Error('Use 2–32 letters, numbers, periods, underscores, or hyphens.')
  }
  const displayName = input.displayName.trim()
  const bio = input.bio.trim()
  const location = input.location?.trim()
  const websiteUrl = input.websiteUrl?.trim()
  if (!displayName || displayName.length > 120) throw new Error('WAVE display names are limited to 120 characters.')
  if (bio.length > NET_ALTARA_WAVE_BIO_MAX_LENGTH) throw new Error(`WAVE bios are limited to ${NET_ALTARA_WAVE_BIO_MAX_LENGTH} characters.`)
  if (location && location.length > 120) throw new Error('WAVE locations are limited to 120 characters.')
  if (websiteUrl && (!/^https:\/\/[^\s]+$/i.test(websiteUrl) || websiteUrl.length > 500)) {
    throw new Error('Use a complete HTTPS link for the WAVE website field.')
  }
  return { ...input, handle, displayName, bio, ...(location ? { location } : {}), ...(websiteUrl ? { websiteUrl } : {}) }
}

export async function fetchNetAltaraWaveSession(expectedIdentityLinkId: string): Promise<NetAltaraWaveSession> {
  const { data, error } = await client().rpc('fetch_net_altara_wave_session', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
  })
  if (error) throw mapWaveError('WAVE identity could not be loaded', error.message)
  if (!isRecord(data)) throw new Error('WAVE returned an invalid identity session.')
  const account = data.account ? parseAccount(data.account) : null
  const hydrated = account ? await hydrateMedia({ accounts: [account] }) : null
  return {
    identityLinkId: stringValue(data.identity_link_id, 'identity link'),
    canonicalDisplayName: stringValue(data.canonical_display_name, 'canonical display name'),
    account: hydrated?.accounts?.[0] ?? null,
    unreadCount: countValue(data.unread_count ?? 0, 'unread notification count'),
  }
}

export async function createNetAltaraWaveAccount(expectedIdentityLinkId: string, handleInput: string): Promise<NetAltaraWaveSession> {
  const handle = normalizeNetHandle(handleInput)
  if (!handle) throw new Error('Choose a valid WAVE handle.')
  const { data, error } = await client().rpc('create_net_altara_wave_account', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_handle: handle,
  })
  if (error) throw mapWaveError('WAVE profile could not be created', error.message)
  if (!isRecord(data)) throw new Error('WAVE returned an invalid account activation response.')
  const account = parseAccount(data.account)
  return {
    identityLinkId: stringValue(data.identity_link_id, 'identity link'),
    canonicalDisplayName: stringValue(data.canonical_display_name, 'canonical display name'),
    account,
    unreadCount: countValue(data.unread_count ?? 0, 'unread notification count'),
  }
}

export async function updateNetAltaraWaveProfile(
  expectedIdentityLinkId: string,
  expectedAccountId: string,
  input: NetAltaraWaveProfileInput,
): Promise<NetAltaraWaveAccount> {
  const profile = validateProfile(input)
  const { data, error } = await client().rpc('update_net_altara_wave_profile', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_expected_account_id: expectedAccountId,
    requested_handle: profile.handle,
    requested_display_name: profile.displayName,
    requested_bio: profile.bio,
    requested_avatar_ref: profile.avatarRef ?? null,
    requested_banner_ref: profile.bannerRef ?? null,
    requested_location_label: profile.location ?? null,
    requested_website_url: profile.websiteUrl ?? null,
  })
  if (error) throw mapWaveError('WAVE profile could not be saved', error.message)
  const account = parseAccount(data)
  return (await hydrateMedia({ accounts: [account] })).accounts?.[0] ?? account
}

export async function fetchNetAltaraWavePage(input: {
  readonly expectedIdentityLinkId: string
  readonly expectedAccountId: string
  readonly mode: NetAltaraWaveFeedMode
  readonly profileAccountId?: string
  readonly query?: string
  readonly cursor?: NetAltaraWavePageCursor | null
  readonly limit?: number
}): Promise<NetAltaraWavePostPage> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? PAGE_SIZE), 1), MAX_PAGE_SIZE)
  const query = input.query?.trim()
  if (query && query.length > 80) throw new Error('WAVE search is limited to 80 characters.')
  const { data, error } = await client().rpc('fetch_net_altara_wave_page', {
    requested_expected_identity_link_id: input.expectedIdentityLinkId,
    requested_expected_account_id: input.expectedAccountId,
    requested_mode: input.mode,
    requested_profile_account_id: input.profileAccountId ?? null,
    requested_search_query: query || null,
    requested_cursor_at: input.cursor?.sortAt ?? null,
    requested_cursor_id: input.cursor?.id ?? null,
    requested_limit: limit,
  })
  if (error) throw mapWaveError('WAVE feed could not be loaded', error.message)
  if (!isRecord(data)) throw new Error('WAVE returned an invalid feed page.')
  const posts = (Array.isArray(data.items) ? data.items : []).map(parsePost)
  const hydrated = await hydrateMedia({ posts })
  return {
    posts: hydrated.posts ?? [],
    nextCursor: parseCursor(data.next_cursor),
    hasMore: data.has_more === true,
  }
}

export async function fetchNetAltaraWaveThread(input: {
  readonly expectedIdentityLinkId: string
  readonly expectedAccountId: string
  readonly rootPostId: string
  readonly cursor?: NetAltaraWavePageCursor | null
}): Promise<NetAltaraWaveThreadPage> {
  const { data, error } = await client().rpc('fetch_net_altara_wave_thread_page', {
    requested_expected_identity_link_id: input.expectedIdentityLinkId,
    requested_expected_account_id: input.expectedAccountId,
    requested_root_post_id: input.rootPostId,
    requested_cursor_at: input.cursor?.sortAt ?? null,
    requested_cursor_id: input.cursor?.id ?? null,
    requested_limit: 30,
  })
  if (error) throw mapWaveError('WAVE conversation could not be loaded', error.message)
  if (!isRecord(data)) throw new Error('WAVE returned an invalid conversation page.')
  const root = parsePost(data.root)
  const replies = (Array.isArray(data.replies) ? data.replies : []).map(parsePost)
  const hydrated = await hydrateMedia({ posts: [root, ...replies] })
  return {
    root: hydrated.posts?.[0] ?? root,
    replies: hydrated.posts?.slice(1) ?? replies,
    nextCursor: parseCursor(data.next_cursor),
    hasMore: data.has_more === true,
  }
}

export async function createNetAltaraWavePost(input: {
  readonly expectedIdentityLinkId: string
  readonly expectedAccountId: string
  readonly body: string
  readonly requestKey: string
  readonly parentPostId: string | null
}): Promise<NetAltaraWavePost> {
  const body = input.body.trim()
  if (!Object.hasOwn(input, 'parentPostId') || input.parentPostId === undefined) {
    throw new Error('WAVE // REPLY TARGET LOST')
  }
  const parentPostId = input.parentPostId === null ? null : input.parentPostId.trim()
  if (!body) throw new Error('Write something before posting.')
  if (body.length > NET_ALTARA_WAVE_POST_MAX_LENGTH) throw new Error(`WAVE posts are limited to ${NET_ALTARA_WAVE_POST_MAX_LENGTH} characters.`)
  if (input.parentPostId !== null && !parentPostId) throw new Error('WAVE // REPLY TARGET LOST')
  const { data, error } = await client().rpc('create_net_altara_wave_post', {
    requested_expected_identity_link_id: input.expectedIdentityLinkId,
    requested_expected_account_id: input.expectedAccountId,
    requested_request_key: input.requestKey,
    requested_body: body,
    requested_parent_post_id: parentPostId,
    requested_media_ref: null,
  })
  if (error) throw mapWaveError('WAVE post could not be published', error.message)
  return parsePost(data)
}

export async function deleteNetAltaraWavePost(expectedIdentityLinkId: string, expectedAccountId: string, postId: string): Promise<string> {
  const { data, error } = await client().rpc('delete_net_altara_wave_post', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_expected_account_id: expectedAccountId,
    requested_post_id: postId,
  })
  if (error) throw mapWaveError('WAVE post could not be deleted', error.message)
  return stringValue(data, 'deleted post id')
}

async function setBoolean(
  rpc: 'set_net_altara_wave_follow' | 'set_net_altara_wave_reaction' | 'set_net_altara_wave_boost' | 'set_net_altara_wave_bookmark',
  args: Record<string, string | boolean>,
  expected: boolean,
): Promise<boolean> {
  const { data, error } = await client().rpc(rpc, args)
  if (error) throw mapWaveError('WAVE state could not be updated', error.message)
  if (data !== expected) throw new Error('WAVE returned an unexpected state confirmation.')
  return data
}

export function setNetAltaraWaveFollow(expectedIdentityLinkId: string, expectedAccountId: string, targetAccountId: string, following: boolean) {
  return setBoolean('set_net_altara_wave_follow', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_expected_account_id: expectedAccountId,
    requested_target_account_id: targetAccountId,
    requested_following: following,
  }, following)
}

export function setNetAltaraWaveReaction(expectedIdentityLinkId: string, expectedAccountId: string, postId: string, reacted: boolean) {
  return setBoolean('set_net_altara_wave_reaction', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_expected_account_id: expectedAccountId,
    requested_post_id: postId,
    requested_reacted: reacted,
  }, reacted)
}

export function setNetAltaraWaveBoost(expectedIdentityLinkId: string, expectedAccountId: string, postId: string, boosted: boolean) {
  return setBoolean('set_net_altara_wave_boost', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_expected_account_id: expectedAccountId,
    requested_post_id: postId,
    requested_boosted: boosted,
  }, boosted)
}

export function setNetAltaraWaveBookmark(expectedIdentityLinkId: string, expectedAccountId: string, postId: string, bookmarked: boolean) {
  return setBoolean('set_net_altara_wave_bookmark', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_expected_account_id: expectedAccountId,
    requested_post_id: postId,
    requested_bookmarked: bookmarked,
  }, bookmarked)
}

export async function fetchNetAltaraWaveAccounts(input: {
  readonly expectedIdentityLinkId: string
  readonly expectedAccountId: string
  readonly query?: string
  readonly accountId?: string
  readonly cursor?: NetAltaraWavePageCursor | null
  readonly limit?: number
}): Promise<NetAltaraWaveRelationshipPage> {
  const query = input.query?.trim().replace(/^@/, '')
  if (query && query.length > 80) throw new Error('WAVE people search is limited to 80 characters.')
  const { data, error } = await client().rpc('fetch_net_altara_wave_accounts', {
    requested_expected_identity_link_id: input.expectedIdentityLinkId,
    requested_expected_account_id: input.expectedAccountId,
    requested_query: query || null,
    requested_account_id: input.accountId ?? null,
    requested_cursor_at: input.cursor?.sortAt ?? null,
    requested_cursor_id: input.cursor?.id ?? null,
    requested_limit: Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 40),
  })
  if (error) throw mapWaveError('WAVE people could not be loaded', error.message)
  if (!isRecord(data)) throw new Error('WAVE returned an invalid people page.')
  const accounts = (Array.isArray(data.items) ? data.items : []).map(parseAccount)
  const hydrated = await hydrateMedia({ accounts })
  return {
    accounts: hydrated.accounts ?? [],
    nextCursor: parseCursor(data.next_cursor),
    hasMore: data.has_more === true,
  }
}

export async function fetchNetAltaraWaveRelationships(input: {
  readonly expectedIdentityLinkId: string
  readonly expectedAccountId: string
  readonly profileAccountId: string
  readonly direction: 'followers' | 'following'
  readonly cursor?: NetAltaraWavePageCursor | null
}): Promise<NetAltaraWaveRelationshipPage> {
  const { data, error } = await client().rpc('fetch_net_altara_wave_relationship_page', {
    requested_expected_identity_link_id: input.expectedIdentityLinkId,
    requested_expected_account_id: input.expectedAccountId,
    requested_profile_account_id: input.profileAccountId,
    requested_direction: input.direction,
    requested_cursor_at: input.cursor?.sortAt ?? null,
    requested_cursor_id: input.cursor?.id ?? null,
    requested_limit: 30,
  })
  if (error) throw mapWaveError('WAVE relationships could not be loaded', error.message)
  if (!isRecord(data)) throw new Error('WAVE returned an invalid relationship page.')
  const accounts = (Array.isArray(data.items) ? data.items : []).map(parseAccount)
  const hydrated = await hydrateMedia({ accounts })
  return { accounts: hydrated.accounts ?? [], nextCursor: parseCursor(data.next_cursor), hasMore: data.has_more === true }
}

function parseNotification(value: unknown): NetAltaraWaveNotification {
  if (!isRecord(value)) throw new Error('Invalid WAVE notification response.')
  const type = value.notification_type
  if (!['follow', 'reaction', 'boost', 'reply', 'mention'].includes(String(type))) {
    throw new Error('Invalid WAVE notification type.')
  }
  return {
    id: stringValue(value.id, 'notification id'),
    type: type as NetAltaraWaveNotification['type'],
    actor: parseAccount(value.actor),
    ...(optionalString(value.post_id) ? { postId: optionalString(value.post_id) } : {}),
    ...(optionalString(value.root_post_id) ? { rootPostId: optionalString(value.root_post_id) } : {}),
    ...(optionalString(value.post_excerpt) ? { excerpt: optionalString(value.post_excerpt) } : {}),
    postAvailable: value.post_available === true,
    createdAt: stringValue(value.created_at, 'notification timestamp'),
    ...(optionalString(value.read_at) ? { readAt: optionalString(value.read_at) } : {}),
  }
}

export async function fetchNetAltaraWaveNotifications(input: {
  readonly expectedIdentityLinkId: string
  readonly expectedAccountId: string
  readonly cursor?: NetAltaraWavePageCursor | null
}): Promise<NetAltaraWaveNotificationPage> {
  const { data, error } = await client().rpc('fetch_net_altara_wave_notification_page', {
    requested_expected_identity_link_id: input.expectedIdentityLinkId,
    requested_expected_account_id: input.expectedAccountId,
    requested_cursor_at: input.cursor?.sortAt ?? null,
    requested_cursor_id: input.cursor?.id ?? null,
    requested_limit: 20,
  })
  if (error) throw mapWaveError('WAVE notifications could not be loaded', error.message)
  if (!isRecord(data)) throw new Error('WAVE returned an invalid notification page.')
  const notifications = (Array.isArray(data.items) ? data.items : []).map(parseNotification)
  const hydrated = await hydrateMedia({ accounts: notifications.map((notification) => notification.actor) })
  const actors = new Map((hydrated.accounts ?? []).map((account) => [account.id, account]))
  return {
    notifications: notifications.map((notification) => ({ ...notification, actor: actors.get(notification.actor.id) ?? notification.actor })),
    nextCursor: parseCursor(data.next_cursor),
    hasMore: data.has_more === true,
    unreadCount: countValue(data.unread_count ?? 0, 'unread notification count'),
  }
}

export async function markNetAltaraWaveNotificationRead(expectedIdentityLinkId: string, expectedAccountId: string, notificationId?: string): Promise<number> {
  const { data, error } = await client().rpc('mark_net_altara_wave_notifications_read', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_expected_account_id: expectedAccountId,
    requested_notification_id: notificationId ?? null,
  })
  if (error) throw mapWaveError('WAVE notification state could not be updated', error.message)
  return countValue(data, 'updated notification count')
}
