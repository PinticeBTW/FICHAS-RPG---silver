import { normalizeNetHandle } from '../components/net/accounts/netAppAccountSelectors'
import { isSharedMediaReference } from './media/mediaReference'
import { resolveSharedMediaUrls } from './media/mediaStorage'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import { mapNetPulseRpcError } from './netPulseRequestContext'

export type NetPulseNotificationType = 'follow' | 'reaction' | 'boost' | 'reply' | 'mention'

export interface NetPulseNotification {
  readonly id: string
  readonly type: NetPulseNotificationType
  readonly actorAccountId: string
  readonly actorHandle: string
  readonly actorAvatarUrl?: string
  readonly postId?: string
  readonly rootPostId?: string
  readonly postExcerpt?: string
  readonly postAvailable: boolean
  readonly createdAt: string
  readonly readAt?: string
}

export interface NetPulseNotificationCursor {
  readonly createdAt: string
  readonly id: string
}

export interface NetPulseNotificationPage {
  readonly notifications: readonly NetPulseNotification[]
  readonly nextCursor: NetPulseNotificationCursor | null
  readonly hasMore: boolean
}

interface NotificationRow {
  readonly id: string
  readonly notification_type: NetPulseNotificationType
  readonly actor_account_id: string
  readonly actor_handle: string
  readonly actor_avatar_url: string | null
  readonly post_id: string | null
  readonly root_post_id: string | null
  readonly post_excerpt: string | null
  readonly post_available: boolean
  readonly created_at: string
  readonly read_at: string | null
  readonly page_has_more: boolean
}

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseNotification(value: unknown): NetPulseNotification {
  if (!isRecord(value)) throw new Error('Invalid PULSE notification response.')
  const row = value as unknown as NotificationRow
  const actorHandle = normalizeNetHandle(row.actor_handle)
  if (
    typeof row.id !== 'string'
    || !row.id
    || !['follow', 'reaction', 'boost', 'reply', 'mention'].includes(row.notification_type)
    || typeof row.actor_account_id !== 'string'
    || !row.actor_account_id
    || !actorHandle
    || typeof row.post_available !== 'boolean'
    || typeof row.created_at !== 'string'
    || typeof row.page_has_more !== 'boolean'
  ) {
    throw new Error('Invalid PULSE notification fields returned by the server.')
  }
  return {
    id: row.id,
    type: row.notification_type,
    actorAccountId: row.actor_account_id,
    actorHandle,
    ...(typeof row.actor_avatar_url === 'string' && row.actor_avatar_url.trim()
      ? { actorAvatarUrl: row.actor_avatar_url.trim() }
      : {}),
    ...(typeof row.post_id === 'string' && row.post_id ? { postId: row.post_id } : {}),
    ...(typeof row.root_post_id === 'string' && row.root_post_id
      ? { rootPostId: row.root_post_id }
      : {}),
    ...(typeof row.post_excerpt === 'string' && row.post_excerpt.trim()
      ? { postExcerpt: row.post_excerpt.trim() }
      : {}),
    postAvailable: row.post_available,
    createdAt: row.created_at,
    ...(typeof row.read_at === 'string' && row.read_at ? { readAt: row.read_at } : {}),
  }
}

async function resolveNotificationMedia(
  notifications: readonly NetPulseNotification[],
): Promise<readonly NetPulseNotification[]> {
  const references = notifications.map((notification) => notification.actorAvatarUrl).filter(
    (value): value is string => Boolean(value && isSharedMediaReference(value)),
  )
  if (!references.length) return notifications
  try {
    const urls = await resolveSharedMediaUrls(references, 'thumbnail')
    return notifications.map((notification) => {
      if (!notification.actorAvatarUrl || !isSharedMediaReference(notification.actorAvatarUrl)) {
        return notification
      }
      const avatarUrl = urls.get(notification.actorAvatarUrl)
      return avatarUrl ? { ...notification, actorAvatarUrl: avatarUrl } : notification
    })
  } catch {
    return notifications
  }
}

export async function fetchNetPulseNotificationPage(
  expectedAccountId: string,
  cursor: NetPulseNotificationCursor | null = null,
  limit = 20,
): Promise<NetPulseNotificationPage> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 40)
  const { data, error } = await client().rpc('fetch_net_pulse_notification_page', {
    requested_cursor_at: cursor?.createdAt ?? null,
    requested_cursor_id: cursor?.id ?? null,
    requested_limit: safeLimit,
    requested_expected_account_id: expectedAccountId,
  })
  if (error) throw mapNetPulseRpcError('PULSE notifications could not be loaded', error.message)
  const rows = (data as unknown[] | null) ?? []
  const notifications = await resolveNotificationMedia(rows.map(parseNotification))
  const last = notifications.at(-1)
  return {
    notifications,
    nextCursor: last ? { createdAt: last.createdAt, id: last.id } : null,
    hasMore: rows.some((row) => isRecord(row) && row.page_has_more === true),
  }
}

export async function fetchNetPulseNotificationState(expectedAccountId: string): Promise<{
  readonly unreadCount: number
}> {
  const { data, error } = await client().rpc('fetch_net_pulse_notification_state', {
    requested_expected_account_id: expectedAccountId,
  })
  if (error) throw mapNetPulseRpcError('PULSE unread state could not be loaded', error.message)
  const value = Array.isArray(data) ? data[0] : data
  if (!isRecord(value)) throw new Error('PULSE unread state returned an invalid response.')
  const count = typeof value.unread_count === 'number'
    ? value.unread_count
    : Number(value.unread_count)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('PULSE unread state returned an invalid count.')
  }
  return { unreadCount: count }
}

export async function markNetPulseNotificationRead(notificationId: string, expectedAccountId: string): Promise<string> {
  const id = notificationId.trim()
  if (!id) throw new Error('A PULSE notification is required.')
  const { data, error } = await client().rpc('mark_net_pulse_notification_read', {
    requested_notification_id: id,
    requested_expected_account_id: expectedAccountId,
  })
  if (error) throw mapNetPulseRpcError('PULSE notification could not be marked read', error.message)
  const markedId = Array.isArray(data) ? data[0] : data
  if (typeof markedId !== 'string' || !markedId) {
    throw new Error('PULSE notification read state returned an invalid response.')
  }
  return markedId
}

export async function markAllNetPulseNotificationsRead(expectedAccountId: string): Promise<number> {
  const { data, error } = await client().rpc('mark_all_net_pulse_notifications_read', {
    requested_expected_account_id: expectedAccountId,
  })
  if (error) throw mapNetPulseRpcError('PULSE notifications could not be marked read', error.message)
  const value = Array.isArray(data) ? data[0] : data
  const count = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('PULSE mark-all state returned an invalid response.')
  }
  return count
}
