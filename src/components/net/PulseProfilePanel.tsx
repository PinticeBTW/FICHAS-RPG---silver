import { ArrowLeft, BadgeCheck, MapPin, Pencil, UserCheck, UserPlus } from 'lucide-react'

import { formatPulseCount, type PulseAccount, type PulsePostData } from './pulseData'
import { PulseLoadMore } from './PulseLoadMore'
import { PulsePost } from './PulsePost'
import { SharedMediaImage } from '../shared/SharedMediaImage'

interface PulseProfilePanelProps {
  account: PulseAccount
  posts: PulsePostData[]
  postsById: Map<string, PulsePostData>
  accountsById: Map<string, PulseAccount>
  isSelf: boolean
  isFollowing: boolean
  followPending?: boolean
  metricsPending?: boolean
  socialGraphAvailable?: boolean
  onToggleFollow: () => void
  onOpenFollowers: () => void
  onOpenFollowing: () => void
  onBack: () => void
  onOpenThread: (postId: string) => void
  onOpenProfile: (accountId: string) => void
  onReact: (postId: string) => void
  onBoost: (postId: string) => void
  onBookmark: (postId: string) => void
  onDistrictClick?: (district: string) => void
  onTopicClick?: (topic: string) => void
  readOnly?: boolean
  readOnlyNotice?: string
  onEdit?: () => void
  controlledEdit?: boolean
  canDeletePost?: (post: PulsePostData) => boolean
  isControlledDelete?: (post: PulsePostData) => boolean
  onRequestDelete?: (post: PulsePostData) => void
  isInteractionPending?: (postId: string, action: 'reaction' | 'boost' | 'bookmark') => boolean
  hasMorePosts?: boolean
  loadingMorePosts?: boolean
  pageLoadFailed?: boolean
  onLoadMorePosts?: () => void
}

export function PulseProfilePanel({
  account,
  posts,
  postsById,
  accountsById,
  isSelf,
  isFollowing,
  followPending = false,
  metricsPending = false,
  socialGraphAvailable = true,
  onToggleFollow,
  onOpenFollowers,
  onOpenFollowing,
  onBack,
  onOpenThread,
  onOpenProfile,
  onReact,
  onBoost,
  onBookmark,
  onDistrictClick,
  onTopicClick,
  readOnly = false,
  readOnlyNotice,
  onEdit,
  controlledEdit = false,
  canDeletePost,
  isControlledDelete,
  onRequestDelete,
  isInteractionPending,
  hasMorePosts = false,
  loadingMorePosts = false,
  pageLoadFailed = false,
  onLoadMorePosts,
}: PulseProfilePanelProps) {
  return (
    <div className="pulse-profile">
      <button type="button" className="pulse-back" onClick={onBack}>
        <ArrowLeft size={14} />
        Back
      </button>

      <div className="pulse-profile__header">
        <span className="pulse-profile__avatar">
          {account.avatarUrl ? (
            <SharedMediaImage source={account.avatarUrl} variant="thumbnail" alt="" fallback={<span>{account.handle.slice(0, 1).toUpperCase()}</span>} />
          ) : (
            account.handle.slice(0, 1).toUpperCase()
          )}
        </span>

        <div className="pulse-profile__identity">
          <div className="pulse-profile__name-row">
            <strong>@{account.handle}</strong>
            {account.verified ? <BadgeCheck size={15} /> : null}
          </div>

          {account.organisation ? (
            <span className="pulse-profile__org">{account.organisation}</span>
          ) : null}

          {account.district ? (
            <button
              type="button"
              className="pulse-post__district"
              onClick={() => onDistrictClick?.(account.district as string)}
            >
              <MapPin size={11} />
              {account.district}
            </button>
          ) : null}
        </div>

        {isSelf && onEdit && (!readOnly || controlledEdit) ? (
          <button type="button" className="pulse-profile__edit" data-compromised={controlledEdit ? 'true' : 'false'} onClick={onEdit}>
            <Pencil size={13} /> {controlledEdit ? 'Control profile' : 'Edit profile'}
          </button>
        ) : !isSelf && !readOnly && account.visibility !== 'limited' ? (
          <button
            type="button"
            className="pulse-profile__follow"
            data-following={isFollowing ? 'true' : 'false'}
            disabled={followPending}
            aria-busy={followPending}
            aria-pressed={isFollowing}
            onClick={onToggleFollow}
          >
            {isFollowing ? <UserCheck size={14} /> : <UserPlus size={14} />}
            {followPending ? 'Syncing' : isFollowing ? 'Following' : 'Follow'}
          </button>
        ) : null}
      </div>

      <p className="pulse-profile__bio">{account.bio}</p>

      {readOnlyNotice ? (
        <p className="pulse-controlled-context" role="status">{readOnlyNotice}</p>
      ) : null}

      <div className="pulse-profile__stats" aria-busy={metricsPending}>
        <button
          type="button"
          disabled={metricsPending || !socialGraphAvailable}
          onClick={onOpenFollowing}
          aria-label={`View accounts followed by @${account.handle}`}
        >
          <strong>{metricsPending ? '—' : formatPulseCount(account.following)}</strong>
          <span>FOLLOWING</span>
        </button>

        <button
          type="button"
          disabled={metricsPending || !socialGraphAvailable}
          onClick={onOpenFollowers}
          aria-label={`View followers of @${account.handle}`}
        >
          <strong>{metricsPending ? '—' : formatPulseCount(account.followers)}</strong>
          <span>FOLLOWERS</span>
        </button>

        <div>
          <strong>{metricsPending ? '—' : formatPulseCount(account.pulses ?? posts.length)}</strong>
          <span>PULSES</span>
        </div>
      </div>

      <div className="pulse-profile__posts">
        {posts.length === 0 ? (
          <p className="pulse-empty">No Pulses from this account yet.</p>
        ) : (
          posts.map((post) => {
            const quoted = post.quotedPostId
              ? postsById.get(post.quotedPostId)
              : undefined

            return (
              <PulsePost
                key={post.id}
                post={post}
                author={account}
                quoted={
                  quoted
                    ? {
                        post: quoted,
                        author: accountsById.get(quoted.authorId) ?? account,
                      }
                    : null
                }
                onOpenThread={onOpenThread}
                onOpenProfile={onOpenProfile}
                onReact={onReact}
                onBoost={onBoost}
                onBookmark={onBookmark}
                onDistrictClick={onDistrictClick}
                onTopicClick={onTopicClick}
                readOnlyActions={readOnly}
                reactionPending={Boolean(isInteractionPending?.(post.id, 'reaction'))}
                boostPending={Boolean(isInteractionPending?.(post.id, 'boost'))}
                bookmarkPending={Boolean(isInteractionPending?.(post.id, 'bookmark'))}
                {...(canDeletePost?.(post) && onRequestDelete
                  ? {
                      onDelete: () => onRequestDelete(post),
                      deleteLabel: 'Delete Pulse' as const,
                      controlledDelete: isControlledDelete?.(post) ?? false,
                    }
                  : {})}
              />
            )
          })
        )}
      </div>
      {onLoadMorePosts ? (
        <PulseLoadMore
          available={hasMorePosts}
          pending={loadingMorePosts}
          failed={pageLoadFailed}
          label="Load more Pulses"
          onLoad={onLoadMorePosts}
        />
      ) : null}
    </div>
  )
}
