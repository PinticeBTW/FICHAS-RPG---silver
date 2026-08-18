import type {
  NetAltaraConversationDetail,
  NetAltaraConversationMember,
  NetAltaraConversationMutationResult,
  NetAltaraConversationSummary,
  NetAltaraDeleteGroupResult,
  NetAltaraLatestMessage,
  NetAltaraLeaveGroupResult,
  NetAltaraMessage,
  NetAltaraMessageCursor,
  NetAltaraMessagePage,
  NetAltaraMessengerIdentity,
  NetAltaraMessengerSidebar,
  NetAltaraReadCursorResult,
  NetAltaraSendMessageResult,
} from './netAltaraMessengerTypes'
import { isSharedMediaReference } from './media/mediaReference'
import { resolveSharedMediaUrls } from './media/mediaStorage'
import { SHARED_MEDIA_REFERENCE_PREFIX } from './media/mediaTypes'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

function client() {
  if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
  return supabase
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`ALTARA Messenger returned an invalid ${label}.`)
  }
  return value as Record<string, unknown>
}

function requiredString(row: Record<string, unknown>, key: string, label: string): string {
  const value = row[key]
  if (typeof value !== 'string' || !value) {
    throw new Error(`ALTARA Messenger returned an invalid ${label}.`)
  }
  return value
}

function optionalString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key]
  return typeof value === 'string' && value ? value : undefined
}

function timestamp(row: Record<string, unknown>, key: string, label: string): string {
  const value = requiredString(row, key, label)
  if (Number.isNaN(Date.parse(value))) throw new Error(`ALTARA Messenger returned an invalid ${label}.`)
  return value
}

function integer(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
    throw new Error(`ALTARA Messenger returned an invalid ${label}.`)
  }
  return parsed
}

function parseIdentity(value: unknown): NetAltaraMessengerIdentity {
  const row = record(value, 'identity')
  const avatarUrl = optionalString(row, 'avatar_url')
  return {
    identityLinkId: requiredString(row, 'identity_link_id', 'identity link'),
    displayName: requiredString(row, 'display_name', 'display name'),
    ...(avatarUrl ? { avatarUrl } : {}),
  }
}

function parseMember(value: unknown): NetAltaraConversationMember {
  const row = record(value, 'conversation member')
  const role = row.role
  if (role !== 'owner' && role !== 'member') throw new Error('ALTARA Messenger returned an invalid member role.')
  if (typeof row.available !== 'boolean') throw new Error('ALTARA Messenger returned an invalid member state.')
  return { identity: parseIdentity(row.identity), role, available: row.available }
}

function parseMembers(value: unknown): readonly NetAltaraConversationMember[] {
  if (!Array.isArray(value)) throw new Error('ALTARA Messenger returned invalid conversation members.')
  return value.map(parseMember)
}

function parseLatestMessage(value: unknown): NetAltaraLatestMessage | undefined {
  if (value === null || value === undefined) return undefined
  const row = record(value, 'latest message')
  if (typeof row.mine !== 'boolean') throw new Error('ALTARA Messenger returned an invalid latest-message state.')
  return {
    messageId: requiredString(row, 'message_id', 'latest message id'),
    body: requiredString(row, 'body', 'latest message body'),
    createdAt: timestamp(row, 'created_at', 'latest message timestamp'),
    author: parseIdentity(row.author),
    mine: row.mine,
  }
}

function parseSummary(value: unknown): NetAltaraConversationSummary {
  const row = record(value, 'conversation')
  const kind = row.kind
  const role = row.role
  if (kind !== 'direct' && kind !== 'group') throw new Error('ALTARA Messenger returned an invalid conversation kind.')
  if (role !== 'owner' && role !== 'member') throw new Error('ALTARA Messenger returned an invalid conversation role.')
  if (typeof row.can_send !== 'boolean' || typeof row.unread_capped !== 'boolean') {
    throw new Error('ALTARA Messenger returned an invalid conversation state.')
  }
  const members = parseMembers(row.members)
  const avatarUrl = optionalString(row, 'avatar_url')
  const latestMessage = parseLatestMessage(row.latest_message)
  return {
    conversationId: requiredString(row, 'conversation_id', 'conversation id'),
    kind,
    title: requiredString(row, 'title', 'conversation title'),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(row.direct_recipient ? { directRecipient: parseIdentity(row.direct_recipient) } : {}),
    role,
    members,
    memberCount: integer(row.member_count, 'member count', 16),
    canSend: row.can_send,
    ...(latestMessage ? { latestMessage } : {}),
    unreadCount: integer(row.unread_count, 'unread count', 99),
    unreadCapped: row.unread_capped,
    createdAt: timestamp(row, 'created_at', 'conversation creation timestamp'),
    updatedAt: timestamp(row, 'updated_at', 'conversation update timestamp'),
  }
}

function parseSidebar(value: unknown): NetAltaraMessengerSidebar {
  const row = record(value, 'sidebar payload')
  if (!Array.isArray(row.conversations)) throw new Error('ALTARA Messenger returned an invalid conversation list.')
  if (row.status === 'identity-required') {
    return {
      status: 'identity-required',
      reason: requiredString(row, 'reason', 'identity-required reason'),
      conversations: [],
    }
  }
  if (row.status !== 'ready') throw new Error('ALTARA Messenger returned an unsupported session status.')
  return {
    status: 'ready',
    identity: parseIdentity(row.identity),
    conversations: row.conversations.map(parseSummary),
  }
}

function parseMessage(value: unknown): NetAltaraMessage {
  const row = record(value, 'message')
  if (typeof row.mine !== 'boolean') throw new Error('ALTARA Messenger returned an invalid message state.')
  return {
    messageId: requiredString(row, 'message_id', 'message id'),
    conversationId: requiredString(row, 'conversation_id', 'message conversation'),
    author: parseIdentity(row.author),
    body: requiredString(row, 'body', 'message body'),
    createdAt: timestamp(row, 'created_at', 'message timestamp'),
    mine: row.mine,
  }
}

function parseDetail(value: unknown): NetAltaraConversationDetail {
  const row = record(value, 'conversation detail')
  const kind = row.kind
  const role = row.role
  if (kind !== 'direct' && kind !== 'group') throw new Error('ALTARA Messenger returned an invalid conversation kind.')
  if (role !== 'owner' && role !== 'member') throw new Error('ALTARA Messenger returned an invalid conversation role.')
  if (typeof row.can_send !== 'boolean') throw new Error('ALTARA Messenger returned an invalid send state.')
  const avatarUrl = optionalString(row, 'avatar_url')
  return {
    conversationId: requiredString(row, 'conversation_id', 'conversation id'),
    kind,
    title: requiredString(row, 'title', 'conversation title'),
    ...(avatarUrl ? { avatarUrl } : {}),
    role,
    members: parseMembers(row.members),
    canSend: row.can_send,
    updatedAt: timestamp(row, 'updated_at', 'conversation update timestamp'),
  }
}

function parseCursor(value: unknown): NetAltaraMessageCursor | undefined {
  if (value === null || value === undefined) return undefined
  const row = record(value, 'message cursor')
  return {
    createdAt: timestamp(row, 'created_at', 'message cursor timestamp'),
    messageId: requiredString(row, 'message_id', 'message cursor id'),
  }
}

function parseMessagePage(value: unknown): NetAltaraMessagePage {
  const row = record(value, 'message page')
  if (!Array.isArray(row.messages)) throw new Error('ALTARA Messenger returned an invalid message page.')
  const nextCursor = parseCursor(row.next_cursor)
  return {
    conversation: parseDetail(row.conversation),
    messages: row.messages.map(parseMessage),
    ...(nextCursor ? { nextCursor } : {}),
  }
}

function parseMutation(value: unknown): NetAltaraConversationMutationResult {
  const row = record(value, 'conversation mutation')
  const title = optionalString(row, 'title')
  const removedIdentityLinkId = optionalString(row, 'removed_identity_link_id')
  return {
    conversationId: requiredString(row, 'conversation_id', 'conversation id'),
    ...(typeof row.created === 'boolean' ? { created: row.created } : {}),
    ...(title ? { title } : {}),
    ...(row.added_count !== undefined ? { addedCount: integer(row.added_count, 'added member count', 15) } : {}),
    ...(removedIdentityLinkId ? { removedIdentityLinkId } : {}),
  }
}

function collectAvatarReferences(value: unknown, references: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectAvatarReferences(item, references))
    return
  }
  if (!value || typeof value !== 'object') return

  const row = value as Record<string, unknown>
  if (typeof row.avatarUrl === 'string' && row.avatarUrl) references.add(row.avatarUrl)
  Object.values(row).forEach((item) => collectAvatarReferences(item, references))
}

function replaceAvatarReferences<T>(value: T, resolved: ReadonlyMap<string, string>): T {
  if (Array.isArray(value)) {
    return value.map((item) => replaceAvatarReferences(item, resolved)) as T
  }
  if (!value || typeof value !== 'object') return value

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'avatarUrl' && typeof item === 'string') {
      const signedUrl = resolved.get(item)
      if (signedUrl) result[key] = signedUrl
      else if (!item.startsWith(SHARED_MEDIA_REFERENCE_PREFIX)) result[key] = item
      continue
    }
    result[key] = replaceAvatarReferences(item, resolved)
  }
  return result as T
}

/**
 * Messenger presentation payloads intentionally carry the same private
 * rpg-media descriptors used by sheets, PULSE, and GM identity surfaces.
 * Resolve every descriptor in one cached Storage batch per bounded RPC, then
 * fall back to initials if a descriptor or private object is unavailable.
 */
async function resolveMessengerAvatarReferences<T>(value: T): Promise<T> {
  const references = new Set<string>()
  collectAvatarReferences(value, references)
  const sharedReferences = [...references].filter(isSharedMediaReference)
  if (!sharedReferences.length) return replaceAvatarReferences(value, new Map())

  try {
    const resolved = await resolveSharedMediaUrls(sharedReferences, 'thumbnail')
    return replaceAvatarReferences(value, resolved)
  } catch {
    return replaceAvatarReferences(value, new Map())
  }
}

async function rpc<T>(name: string, args: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
  const { data, error } = await client().rpc(name, args)
  if (error) throw new Error(`ALTARA Messenger request failed: ${error.message}`)
  // Every Messenger RPC returns one jsonb value. A one-result directory search
  // is itself a JSON array and must never be unwrapped here.
  return resolveMessengerAvatarReferences(parse(data))
}

export function fetchNetAltaraMessengerSidebar(expectedIdentityLinkId: string, limit = 50) {
  return rpc('fetch_net_altara_messenger_sidebar', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_limit: limit,
  }, parseSidebar)
}

export function searchNetAltaraMessengerRecipients(expectedIdentityLinkId: string, query: string, limit = 20) {
  return rpc('search_net_altara_messenger_recipients', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_query: query,
    requested_limit: limit,
  }, (value) => {
    if (!Array.isArray(value)) throw new Error('ALTARA Messenger returned invalid recipient results.')
    return value.map(parseIdentity)
  })
}

export function ensureNetAltaraDirectConversation(expectedIdentityLinkId: string, recipientIdentityLinkId: string) {
  return rpc('ensure_net_altara_direct_conversation', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_recipient_identity_link_id: recipientIdentityLinkId,
  }, parseMutation)
}

export function createNetAltaraGroup(expectedIdentityLinkId: string, title: string, memberIdentityLinkIds: readonly string[]) {
  return rpc('create_net_altara_group', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_title: title,
    requested_member_identity_link_ids: [...memberIdentityLinkIds],
  }, parseMutation)
}

export function renameNetAltaraGroup(expectedIdentityLinkId: string, conversationId: string, title: string) {
  return rpc('rename_net_altara_group', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_conversation_id: conversationId,
    requested_title: title,
  }, parseMutation)
}

export function addNetAltaraGroupMembers(expectedIdentityLinkId: string, conversationId: string, memberIdentityLinkIds: readonly string[]) {
  return rpc('add_net_altara_group_members', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_conversation_id: conversationId,
    requested_member_identity_link_ids: [...memberIdentityLinkIds],
  }, parseMutation)
}

export function removeNetAltaraGroupMember(expectedIdentityLinkId: string, conversationId: string, memberIdentityLinkId: string) {
  return rpc('remove_net_altara_group_member', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_conversation_id: conversationId,
    requested_member_identity_link_id: memberIdentityLinkId,
  }, parseMutation)
}

export function leaveNetAltaraGroup(expectedIdentityLinkId: string, conversationId: string): Promise<NetAltaraLeaveGroupResult> {
  return rpc('leave_net_altara_group', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_conversation_id: conversationId,
  }, (value) => {
    const row = record(value, 'leave result')
    if (typeof row.left !== 'boolean') throw new Error('ALTARA Messenger returned an invalid leave state.')
    return {
      conversationId: requiredString(row, 'conversation_id', 'conversation id'),
      left: row.left,
    }
  })
}

export function deleteNetAltaraGroup(expectedIdentityLinkId: string, conversationId: string): Promise<NetAltaraDeleteGroupResult> {
  return rpc('delete_net_altara_group', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_conversation_id: conversationId,
  }, (value) => {
    const row = record(value, 'delete result')
    if (typeof row.deleted !== 'boolean') throw new Error('ALTARA Messenger returned an invalid delete state.')
    return {
      conversationId: requiredString(row, 'conversation_id', 'conversation id'),
      deleted: row.deleted,
    }
  })
}

export function fetchNetAltaraMessagePage(
  expectedIdentityLinkId: string,
  conversationId: string,
  cursor?: NetAltaraMessageCursor,
  limit = 30,
) {
  return rpc('fetch_net_altara_message_page', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_conversation_id: conversationId,
    requested_cursor_at: cursor?.createdAt ?? null,
    requested_cursor_id: cursor?.messageId ?? null,
    requested_limit: limit,
  }, parseMessagePage)
}

export function sendNetAltaraMessage(
  expectedIdentityLinkId: string,
  conversationId: string,
  body: string,
  requestKey: string,
): Promise<NetAltaraSendMessageResult> {
  return rpc('send_net_altara_message', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_conversation_id: conversationId,
    requested_body: body,
    requested_request_key: requestKey,
  }, (value) => {
    const row = record(value, 'sent message')
    const message = parseMessage(row)
    if (typeof row.created !== 'boolean') throw new Error('ALTARA Messenger returned an invalid idempotency state.')
    return { ...message, created: row.created }
  })
}

export function markNetAltaraConversationRead(
  expectedIdentityLinkId: string,
  conversationId: string,
  observedMessageId: string,
): Promise<NetAltaraReadCursorResult> {
  return rpc('mark_net_altara_conversation_read', {
    requested_expected_identity_link_id: expectedIdentityLinkId,
    requested_conversation_id: conversationId,
    requested_observed_message_id: observedMessageId,
  }, (value) => {
    const row = record(value, 'read receipt')
    if (typeof row.updated !== 'boolean') {
      throw new Error('ALTARA Messenger returned an invalid read-cursor state.')
    }
    const lastReadMessageId = optionalString(row, 'last_read_message_id')
    return {
      conversationId: requiredString(row, 'conversation_id', 'read conversation'),
      lastReadAt: timestamp(row, 'last_read_at', 'read timestamp'),
      ...(lastReadMessageId ? { lastReadMessageId } : {}),
      updated: row.updated,
    }
  })
}
