import type {
  NetPulseFeed,
  NetPulsePost,
  NetPulsePublicAuthor,
} from '../../lib/netPulseContentService'
import type { PulseAccount, PulsePostData } from './pulseData'

const SERVER_POST_PREFIX = 'server-pulse:'

export function getPulseServerRuntimeId(serverPostId: string): string {
  return `${SERVER_POST_PREFIX}${serverPostId}`
}

export function getPulseServerPostId(runtimePostId: string): string | null {
  return runtimePostId.startsWith(SERVER_POST_PREFIX)
    ? runtimePostId.slice(SERVER_POST_PREFIX.length) || null
    : null
}

function formatServerCreatedAt(createdAt: string, now: number): {
  readonly minutesAgo: number
  readonly createdLabel: string
} {
  const timestamp = Date.parse(createdAt)
  const minutesAgo = Number.isFinite(timestamp)
    ? Math.max(0, Math.floor((now - timestamp) / 60_000))
    : 0
  const createdLabel = minutesAgo < 1
    ? 'NOW'
    : minutesAgo < 60
      ? `${minutesAgo}M`
      : minutesAgo < 1_440
        ? `${Math.floor(minutesAgo / 60)}H`
        : `${Math.floor(minutesAgo / 1_440)}D`

  return { minutesAgo, createdLabel }
}

function adaptAuthor(author: NetPulsePublicAuthor): PulseAccount {
  return {
    id: author.accountId,
    displayName: `@${author.handle}`,
    handle: author.handle,
    bio: author.bio,
    kind: 'citizen',
    verified: false,
    followers: author.followers,
    following: author.following,
    pulses: author.pulses,
    viewerFollowing: author.viewerFollowing,
    visibility: author.visibility,
    discoverable: author.discoverable,
    ...(author.avatarUrl ? { avatarUrl: author.avatarUrl } : {}),
  }
}

function adaptPost(
  post: NetPulsePost,
  childCountByParentId: ReadonlyMap<string, number>,
  now: number,
): PulsePostData {
  const time = formatServerCreatedAt(post.createdAt, now)
  return {
    id: getPulseServerRuntimeId(post.id),
    serverPostId: post.id,
    serverCreatedAt: post.createdAt,
    authorId: post.authorAccountId,
    content: post.body,
    minutesAgo: time.minutesAgo,
    createdLabel: time.createdLabel,
    ...(post.parentPostId
      ? { replyToPostId: getPulseServerRuntimeId(post.parentPostId) }
      : {}),
    heat: 0,
    replies: post.replyCount ?? childCountByParentId.get(post.id) ?? 0,
    boosts: post.boostCount,
    reactions: post.reactionCount,
    reactedByMe: post.viewerReacted,
    boostedByMe: post.viewerBoosted,
    bookmarkedByMe: post.viewerBookmarked,
    viewerFollowsAuthor: post.viewerFollowsAuthor,
    ...(post.followedBoosterAccountId
      ? { followedBoosterAccountId: post.followedBoosterAccountId }
      : {}),
    ...(post.followedBoosterHandle
      ? { followedBoosterHandle: post.followedBoosterHandle }
      : {}),
    followingActivityAt: post.followingActivityAt,
    mentions: post.mentions,
  }
}

/** Pure bridge into the incumbent local PULSE rendering model. */
export function adaptNetPulseFeed(
  feed: NetPulseFeed,
  now = Date.now(),
): {
  readonly posts: readonly PulsePostData[]
  readonly accounts: readonly PulseAccount[]
} {
  const childCountByParentId = new Map<string, number>()
  for (const post of feed.posts) {
    if (!post.parentPostId) continue
    childCountByParentId.set(
      post.parentPostId,
      (childCountByParentId.get(post.parentPostId) ?? 0) + 1,
    )
  }

  const orderedPosts = [...feed.posts].sort((left, right) => {
    const leftIsTopLevel = !left.parentPostId
    const rightIsTopLevel = !right.parentPostId
    if (leftIsTopLevel && rightIsTopLevel) {
      return Date.parse(right.createdAt) - Date.parse(left.createdAt)
    }
    if (!leftIsTopLevel && !rightIsTopLevel) {
      // Thread rendering keeps the natural conversation direction.
      return Date.parse(left.createdAt) - Date.parse(right.createdAt)
    }
    return leftIsTopLevel ? -1 : 1
  })

  return {
    posts: orderedPosts.map((post) => adaptPost(post, childCountByParentId, now)),
    accounts: feed.authors.map(adaptAuthor),
  }
}
