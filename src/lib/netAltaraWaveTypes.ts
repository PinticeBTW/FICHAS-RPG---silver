export const NET_ALTARA_WAVE_POST_MAX_LENGTH = 360
export const NET_ALTARA_WAVE_BIO_MAX_LENGTH = 240
export const NET_ALTARA_WAVE_HANDLE_MAX_LENGTH = 32

export type NetAltaraWaveAccountStatus = 'active' | 'suspended' | 'disabled'
export type NetAltaraWaveNotificationType = 'follow' | 'reaction' | 'boost' | 'reply' | 'mention'
export type NetAltaraWaveFeedMode = 'home' | 'explore' | 'bookmarks' | 'profile' | 'search'

export interface NetAltaraWaveAccount {
  readonly id: string
  readonly identityLinkId: string
  readonly handle: string
  readonly displayName: string
  readonly bio: string
  readonly avatarRef?: string
  readonly avatarOverrideRef?: string
  readonly bannerRef?: string
  readonly location?: string
  readonly websiteUrl?: string
  readonly status: NetAltaraWaveAccountStatus
  readonly joinedAt: string
  readonly updatedAt: string
  readonly followersCount: number
  readonly followingCount: number
  readonly postsCount: number
  readonly viewerFollowing: boolean
  readonly viewerOwns: boolean
}

export interface NetAltaraWaveSession {
  readonly identityLinkId: string
  readonly canonicalDisplayName: string
  readonly account: NetAltaraWaveAccount | null
  readonly unreadCount: number
}

export interface NetAltaraWaveMention {
  readonly accountId: string
  readonly sourceHandle: string
  readonly currentHandle: string
}

export interface NetAltaraWavePost {
  readonly id: string
  readonly authorAccountId: string
  readonly parentPostId?: string
  readonly rootPostId?: string
  readonly body: string
  readonly mediaRef?: string
  readonly deleted: boolean
  readonly createdAt: string
  readonly updatedAt: string
  readonly activityAt: string
  readonly replyCount: number
  readonly reactionCount: number
  readonly boostCount: number
  readonly viewerReacted: boolean
  readonly viewerBoosted: boolean
  readonly viewerBookmarked: boolean
  readonly boostedBy?: Pick<NetAltaraWaveAccount, 'id' | 'handle' | 'displayName'>
  readonly mentions: readonly NetAltaraWaveMention[]
  readonly author: NetAltaraWaveAccount
}

export interface NetAltaraWavePageCursor {
  readonly sortAt: string
  readonly id: string
}

export interface NetAltaraWavePostPage {
  readonly posts: readonly NetAltaraWavePost[]
  readonly nextCursor: NetAltaraWavePageCursor | null
  readonly hasMore: boolean
}

export interface NetAltaraWaveThreadPage {
  readonly root: NetAltaraWavePost
  readonly replies: readonly NetAltaraWavePost[]
  readonly nextCursor: NetAltaraWavePageCursor | null
  readonly hasMore: boolean
}

export interface NetAltaraWaveNotification {
  readonly id: string
  readonly type: NetAltaraWaveNotificationType
  readonly actor: NetAltaraWaveAccount
  readonly postId?: string
  readonly rootPostId?: string
  readonly excerpt?: string
  readonly postAvailable: boolean
  readonly createdAt: string
  readonly readAt?: string
}

export interface NetAltaraWaveNotificationPage {
  readonly notifications: readonly NetAltaraWaveNotification[]
  readonly nextCursor: NetAltaraWavePageCursor | null
  readonly hasMore: boolean
  readonly unreadCount: number
}

export interface NetAltaraWaveRelationshipPage {
  readonly accounts: readonly NetAltaraWaveAccount[]
  readonly nextCursor: NetAltaraWavePageCursor | null
  readonly hasMore: boolean
}

export interface NetAltaraWaveProfileInput {
  readonly handle: string
  readonly displayName: string
  readonly bio: string
  readonly avatarRef?: string
  readonly bannerRef?: string
  readonly location?: string
  readonly websiteUrl?: string
}

export interface NetAltaraWaveRealtimeEvent {
  readonly contentRevision: number
  readonly profileRevision: number
  readonly engagementRevision: number
  readonly notificationRevision: number
  readonly entity?: string
  readonly operation?: string
  readonly resourceId?: string
}

export class NetAltaraWaveContextChangedError extends Error {
  constructor(message = 'The WAVE runtime identity changed. Reopen the application.') {
    super(message)
    this.name = 'NetAltaraWaveContextChangedError'
  }
}
