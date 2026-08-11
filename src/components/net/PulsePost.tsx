import {
  BadgeCheck,
  Bookmark,
  BookmarkCheck,
  Flame,
  MapPin,
  MessageCircle,
  Repeat2,
  ShieldAlert,
  Trash2,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { MouseEvent } from 'react'

import { formatPulseCount, type PulseAccount, type PulseMediaKind, type PulsePostData } from './pulseData'
import { SharedMediaImage } from '../shared/SharedMediaImage'
import { PulseMentionText } from './PulseMentionText'

const MEDIA_LABELS: Record<PulseMediaKind, string> = {
  city: 'CITY VISUAL',
  signal: 'SIGNAL BULLETIN',
  incident: 'INCIDENT FEED',
  chart: 'HEAT CHART',
}

interface PulsePostProps {
  post: PulsePostData
  author: PulseAccount
  quoted?: { post: PulsePostData; author: PulseAccount } | null
  variant?: 'feed' | 'thread' | 'reply'
  onOpenThread: (postId: string) => void
  onOpenProfile: (accountId: string) => void
  onReact: (postId: string) => void
  onBoost: (postId: string) => void
  onBookmark: (postId: string) => void
  /** Used by the compromised public-profile inspection surface. */
  readOnlyActions?: boolean
  onDistrictClick?: (district: string) => void
  onTopicClick?: (topic: string) => void
  onDelete?: () => void
  deleteLabel?: 'Delete Pulse' | 'Delete reply'
  controlledDelete?: boolean
  boostContextHandle?: string
  reactionPending?: boolean
  boostPending?: boolean
  bookmarkPending?: boolean
}

function AuthorBadge({ author }: { author: PulseAccount }) {
  if (!author.verified) {
    return null
  }

  return (
    <BadgeCheck
      size={13}
      className="pulse-post__verified"
      aria-label="Verified account"
    />
  )
}

function ActionButton({
  icon: Icon,
  label,
  count,
  active,
  pending = false,
  onClick,
}: {
  icon: LucideIcon
  label: string
  count: number
  active?: boolean
  pending?: boolean
  onClick: (event: MouseEvent) => void
}) {
  return (
    <button
      type="button"
      className="pulse-post__action"
      data-active={active ? 'true' : 'false'}
      disabled={pending}
      aria-busy={pending}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon size={14} />
      <span>{formatPulseCount(count)}</span>
    </button>
  )
}

export function PulsePost({
  post,
  author,
  quoted,
  variant = 'feed',
  onOpenThread,
  onOpenProfile,
  onReact,
  onBoost,
  onBookmark,
  readOnlyActions = false,
  onDistrictClick,
  onTopicClick,
  onDelete,
  deleteLabel = 'Delete Pulse',
  controlledDelete = false,
  boostContextHandle,
  reactionPending = false,
  boostPending = false,
  bookmarkPending = false,
}: PulsePostProps) {
  const heatBand = post.heat >= 80 ? 'high' : post.heat >= 50 ? 'medium' : 'low'

  const stop = (event: MouseEvent, action: () => void) => {
    event.stopPropagation()
    action()
  }

  return (
    <article
      className="pulse-post"
      data-variant={variant}
      data-kind={author.kind}
      data-heat={heatBand}
      data-corrupted={post.corrupted ? 'true' : 'false'}
      data-breaking={post.breaking ? 'true' : 'false'}
    >
      <button
        type="button"
        className="pulse-post__avatar"
        onClick={(event) => stop(event, () => onOpenProfile(author.id))}
        aria-label={`Open @${author.handle}'s profile`}
        title={`@${author.handle}`}
      >
        {author.avatarUrl ? (
          <SharedMediaImage source={author.avatarUrl} variant="thumbnail" alt="" loading="lazy" decoding="async" fallback={<span>{author.handle.slice(0, 1).toUpperCase()}</span>} />
        ) : (
          <span>{author.handle.slice(0, 1).toUpperCase()}</span>
        )}
      </button>

      <div className="pulse-post__body">
        {boostContextHandle ? (
          <p className="pulse-post__boost-context"><Repeat2 size={12} /> @{boostContextHandle} BOOSTED</p>
        ) : null}
        <header className="pulse-post__head">
          <button
            type="button"
            className="pulse-post__author"
            onClick={(event) => stop(event, () => onOpenProfile(author.id))}
          >
            <strong>@{author.handle}</strong>
            <AuthorBadge author={author} />
          </button>

          {post.breaking ? <i className="pulse-post__breaking">BREAKING</i> : null}

          {post.district ? (
            <button
              type="button"
              className="pulse-post__district"
              onClick={(event) =>
                stop(event, () => onDistrictClick?.(post.district as string))
              }
            >
              <MapPin size={11} />
              {post.district}
            </button>
          ) : null}

          <time>{post.createdLabel}</time>
        </header>

        {post.corrupted ? (
          <p className="pulse-post__content pulse-post__content--corrupted">
            <ShieldAlert size={13} />
            {post.content}
          </p>
        ) : (
          <p className="pulse-post__content">
            <PulseMentionText
              text={post.content}
              mentions={post.mentions}
              onOpenProfile={onOpenProfile}
            />
          </p>
        )}

        {post.hashtags?.length ? (
          <div className="pulse-post__tags">
            {post.hashtags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={(event) => stop(event, () => onTopicClick?.(tag))}
              >
                #{tag}
              </button>
            ))}
          </div>
        ) : null}

        {post.media ? (
          <div className="pulse-post__media" data-kind={post.media.kind}>
            <span>{MEDIA_LABELS[post.media.kind]}</span>
            <strong>{post.media.label}</strong>
          </div>
        ) : null}

        {quoted ? (
          <button
            type="button"
            className="pulse-post__quote"
            onClick={(event) =>
              stop(event, () => onOpenThread(quoted.post.id))
            }
          >
            <strong>
              @{quoted.author.handle}
              {quoted.author.verified ? (
                <BadgeCheck size={11} />
              ) : null}
            </strong>
            <p>{quoted.post.content}</p>
          </button>
        ) : null}

        <footer className="pulse-post__actions">
          <ActionButton
            icon={MessageCircle}
            label={`Open thread with ${formatPulseCount(post.replies)} visible replies`}
            count={post.replies}
            onClick={(event) => stop(event, () => onOpenThread(post.id))}
          />

          {!readOnlyActions ? <>
            {!post.replyToPostId ? (
              <ActionButton
                icon={Repeat2}
                label={post.boostedByMe ? 'Unboost' : 'Boost'}
                count={post.boosts}
                active={post.boostedByMe}
                pending={boostPending}
                onClick={(event) => stop(event, () => onBoost(post.id))}
              />
            ) : null}

            <ActionButton
              icon={Zap}
              label={post.reactedByMe ? 'Unreact' : 'React'}
              count={post.reactions}
              active={post.reactedByMe}
              pending={reactionPending}
              onClick={(event) => stop(event, () => onReact(post.id))}
            />

            <button
              type="button"
              className="pulse-post__action pulse-post__action--bookmark"
              data-active={post.bookmarkedByMe ? 'true' : 'false'}
              disabled={bookmarkPending}
              aria-busy={bookmarkPending}
              onClick={(event) => stop(event, () => onBookmark(post.id))}
              aria-label={post.bookmarkedByMe ? 'Remove bookmark' : 'Bookmark'}
              title={post.bookmarkedByMe ? 'Remove bookmark' : 'Bookmark'}
            >
              {post.bookmarkedByMe ? (
                <BookmarkCheck size={14} />
              ) : (
                <Bookmark size={14} />
              )}
            </button>
          </> : null}

          {onDelete ? (
            <button
              type="button"
              className="pulse-post__delete"
              data-compromised={controlledDelete ? 'true' : 'false'}
              onClick={(event) => stop(event, onDelete)}
              aria-label={deleteLabel}
              title={deleteLabel}
            >
              <Trash2 size={13} />
              <span>{deleteLabel}</span>
            </button>
          ) : null}

          {!post.serverPostId ? (
            <span className="pulse-post__heat">
              <Flame size={12} />
              {post.heat}%
            </span>
          ) : null}
        </footer>
      </div>
    </article>
  )
}
