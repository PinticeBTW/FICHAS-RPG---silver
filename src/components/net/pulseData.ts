export type PulseAccountKind = 'citizen' | 'official' | 'corporate' | 'anonymous'

export interface PulseAccount {
  id: string
  displayName: string
  handle: string
  bio: string
  kind: PulseAccountKind
  verified: boolean
  organisation?: string
  district?: string
  followers: number
  following: number
  pulses?: number
  viewerFollowing?: boolean
  visibility?: 'public' | 'limited'
  discoverable?: boolean
  avatarUrl?: string
}

export type PulseMediaKind = 'city' | 'signal' | 'incident' | 'chart'

export interface PulseMedia {
  kind: PulseMediaKind
  label: string
}

export interface PulsePostData {
  id: string
  /** Present only for durable rows in public.net_pulse_posts. */
  serverPostId?: string
  /** Authoritative database timestamp for durable PULSE ordering only. */
  serverCreatedAt?: string
  authorId: string
  content: string
  minutesAgo: number
  createdLabel: string
  district?: string
  breaking?: boolean
  corrupted?: boolean
  media?: PulseMedia
  quotedPostId?: string
  replyToPostId?: string
  hashtags?: string[]
  heat: number
  replies: number
  boosts: number
  reactions: number
  reactedByMe?: boolean
  boostedByMe?: boolean
  bookmarkedByMe?: boolean
  viewerFollowsAuthor?: boolean
  followedBoosterAccountId?: string
  followedBoosterHandle?: string
  followingActivityAt?: string
  mentions?: readonly {
    accountId: string
    sourceHandle: string
    currentHandle: string
  }[]
}

export function formatPulseCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  }

  return `${value}`
}
