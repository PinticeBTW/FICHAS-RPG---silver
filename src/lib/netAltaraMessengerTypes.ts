export interface NetAltaraMessengerIdentity {
  readonly identityLinkId: string
  readonly displayName: string
  readonly avatarUrl?: string
}

export interface NetAltaraConversationMember {
  readonly identity: NetAltaraMessengerIdentity
  readonly role: 'owner' | 'member'
  readonly available: boolean
}

export interface NetAltaraLatestMessage {
  readonly messageId: string
  readonly body: string
  readonly createdAt: string
  readonly author: NetAltaraMessengerIdentity
  readonly mine: boolean
}

export interface NetAltaraConversationSummary {
  readonly conversationId: string
  readonly kind: 'direct' | 'group'
  readonly title: string
  readonly avatarUrl?: string
  readonly directRecipient?: NetAltaraMessengerIdentity
  readonly role: 'owner' | 'member'
  readonly members: readonly NetAltaraConversationMember[]
  readonly memberCount: number
  readonly canSend: boolean
  readonly latestMessage?: NetAltaraLatestMessage
  readonly unreadCount: number
  readonly unreadCapped: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

export type NetAltaraMessengerSidebar =
  | {
      readonly status: 'identity-required'
      readonly reason: string
      readonly conversations: readonly []
    }
  | {
      readonly status: 'ready'
      readonly identity: NetAltaraMessengerIdentity
      readonly conversations: readonly NetAltaraConversationSummary[]
    }

export interface NetAltaraMessage {
  readonly messageId: string
  readonly conversationId: string
  readonly author: NetAltaraMessengerIdentity
  readonly body: string
  readonly createdAt: string
  readonly mine: boolean
}

export interface NetAltaraMessageCursor {
  readonly createdAt: string
  readonly messageId: string
}

export interface NetAltaraConversationDetail {
  readonly conversationId: string
  readonly kind: 'direct' | 'group'
  readonly title: string
  readonly avatarUrl?: string
  readonly role: 'owner' | 'member'
  readonly members: readonly NetAltaraConversationMember[]
  readonly canSend: boolean
  readonly updatedAt: string
}

export interface NetAltaraMessagePage {
  readonly conversation: NetAltaraConversationDetail
  readonly messages: readonly NetAltaraMessage[]
  readonly nextCursor?: NetAltaraMessageCursor
}

export interface NetAltaraConversationMutationResult {
  readonly conversationId: string
  readonly created?: boolean
  readonly title?: string
  readonly addedCount?: number
  readonly removedIdentityLinkId?: string
}

export interface NetAltaraSendMessageResult extends NetAltaraMessage {
  readonly created: boolean
}

export interface NetAltaraReadCursorResult {
  readonly conversationId: string
  readonly lastReadAt: string
  readonly lastReadMessageId?: string
  readonly updated: boolean
}

export interface NetAltaraLeaveGroupResult {
  readonly conversationId: string
  readonly left: boolean
}

export interface NetAltaraDeleteGroupResult {
  readonly conversationId: string
  readonly deleted: boolean
}

export type NetAltaraMessengerRealtimeStatus =
  | 'idle'
  | 'connecting'
  | 'subscribed'
  | 'disconnected'
