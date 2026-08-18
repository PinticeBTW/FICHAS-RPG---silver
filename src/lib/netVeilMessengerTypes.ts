export interface NetVeilMessengerIdentity {
  readonly identityLinkId: string
  readonly displayName: string
  readonly avatarUrl?: string
}

export interface NetVeilConversationMember {
  readonly identity: NetVeilMessengerIdentity
  readonly role: 'owner' | 'member'
  readonly available: boolean
}

export interface NetVeilLatestMessage {
  readonly messageId: string
  readonly body: string
  readonly createdAt: string
  readonly author: NetVeilMessengerIdentity
  readonly mine: boolean
}

export interface NetVeilConversationSummary {
  readonly conversationId: string
  readonly kind: 'direct' | 'group'
  readonly title: string
  readonly avatarUrl?: string
  readonly directRecipient?: NetVeilMessengerIdentity
  readonly role: 'owner' | 'member'
  readonly members: readonly NetVeilConversationMember[]
  readonly memberCount: number
  readonly canSend: boolean
  readonly latestMessage?: NetVeilLatestMessage
  readonly unreadCount: number
  readonly unreadCapped: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

export type NetVeilMessengerSidebar =
  | {
      readonly status: 'identity-required'
      readonly reason: string
      readonly conversations: readonly []
    }
  | {
      readonly status: 'ready'
      readonly identity: NetVeilMessengerIdentity
      readonly conversations: readonly NetVeilConversationSummary[]
    }

export interface NetVeilMessage {
  readonly messageId: string
  readonly conversationId: string
  readonly author: NetVeilMessengerIdentity
  readonly body: string
  readonly createdAt: string
  readonly mine: boolean
}

export interface NetVeilMessageCursor {
  readonly createdAt: string
  readonly messageId: string
}

export interface NetVeilConversationDetail {
  readonly conversationId: string
  readonly kind: 'direct' | 'group'
  readonly title: string
  readonly avatarUrl?: string
  readonly role: 'owner' | 'member'
  readonly members: readonly NetVeilConversationMember[]
  readonly canSend: boolean
  readonly updatedAt: string
}

export interface NetVeilMessagePage {
  readonly conversation: NetVeilConversationDetail
  readonly messages: readonly NetVeilMessage[]
  readonly nextCursor?: NetVeilMessageCursor
}

export interface NetVeilConversationMutationResult {
  readonly conversationId: string
  readonly created?: boolean
  readonly title?: string
  readonly addedCount?: number
  readonly removedIdentityLinkId?: string
}

export interface NetVeilSendMessageResult extends NetVeilMessage {
  readonly created: boolean
}

export interface NetVeilReadCursorResult {
  readonly conversationId: string
  readonly lastReadAt: string
  readonly lastReadMessageId?: string
  readonly updated: boolean
}

export interface NetVeilLeaveGroupResult {
  readonly conversationId: string
  readonly left: boolean
}

export interface NetVeilDeleteGroupResult {
  readonly conversationId: string
  readonly deleted: boolean
}

export type NetVeilMessengerRealtimeStatus =
  | 'idle'
  | 'connecting'
  | 'subscribed'
  | 'disconnected'
