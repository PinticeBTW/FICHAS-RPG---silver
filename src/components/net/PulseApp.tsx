import {
  ArrowLeft,
  Bell,
  Bookmark,
  Compass,
  Home,
  Radio,
  Search,
  Send,
  ShieldAlert,
  SquarePen,
  User,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import '../../styles/pulse.css'

import { type PulseAccount, type PulsePostData } from './pulseData'
import { PulsePost } from './PulsePost'
import { PulseProfilePanel } from './PulseProfilePanel'
import { PulseAccountSearchResults } from './PulseAccountSearchResults'
import { PulseRelationshipPanel } from './PulseRelationshipPanel'
import { PulseProfileEditor } from './PulseProfileEditor'
import { SharedMediaImage } from '../shared/SharedMediaImage'
import { PulseOnboarding } from './PulseOnboarding'
import {
  adaptNetPulseFeed,
  getPulseServerPostId,
  getPulseServerRuntimeId,
} from './pulseServerContentAdapter'
import { PulseLoadMore } from './PulseLoadMore'
import { PulseNotificationsPanel } from './PulseNotificationsPanel'
import { useNetPulseContent } from './useNetPulseContent'
import { useNetPulseNotifications } from './useNetPulseNotifications'
import { useNetPulseProfile } from './useNetPulseProfile'
import {
  useNetPulseAccountSearch,
  useNetPulseAccountSummary,
  useNetPulseDiscoverAccounts,
  useNetPulseRelationshipAccounts,
} from './useNetPulseEngagementDirectory'
import {
  createCurrentPulseIdentity,
  type PulseProfileDraft,
} from './pulseCurrentIdentity'
import type { NetAppAccount, NetAppAccountResolution } from './accounts/netAppAccountTypes'
import type { NetActiveIdentityState } from './identity/netActiveIdentity'
import type { NetCompromisedPulseSession } from './useNetCompromisedPulseSession'
import {
  NET_PULSE_POST_MAX_LENGTH,
  type NetPulseContentQuery,
  type NetPulsePublicAuthor,
} from '../../lib/netPulseContentService'
import type { NetPulseNotification } from '../../lib/netPulseNotificationService'
import {
  setNetPulseBookmark,
  setNetPulseBoost,
  setNetPulseFollow,
  setNetPulseReaction,
  type NetPulseAccountSummary,
  type NetPulseRelationshipDirection,
} from '../../lib/netPulseEngagementService'
import {
  isNetPulseContextChangedError,
  type NetPulseRequestContext,
} from '../../lib/netPulseRequestContext'

type PulseNav = 'home' | 'discover' | 'bookmarks' | 'notifications' | 'profile'
type PulseFeedTab = 'city' | 'following' | 'raw'
type PulseDeleteMode = 'owner' | 'compromised'

interface PulseRelationshipView {
  readonly profileAccountId: string
  readonly direction: NetPulseRelationshipDirection
  readonly profile: PulseAccount
}

interface PulseNavigationSnapshot {
  readonly nav: PulseNav
  readonly selectedPostId: string | null
  readonly viewingProfileId: string | null
  readonly relationshipView: PulseRelationshipView | null
  readonly searchQuery: string
}

interface PulseDeleteTarget {
  readonly post: PulsePostData
  readonly mode: PulseDeleteMode
}

const MAX_CHARS = NET_PULSE_POST_MAX_LENGTH
const MAX_SEARCH_CHARS = 80

const NAV_ITEMS: { id: PulseNav; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'profile', label: 'Profile', icon: User },
]

const FEED_TABS: { id: PulseFeedTab; label: string }[] = [
  { id: 'city', label: 'City' },
  { id: 'following', label: 'Following' },
  { id: 'raw', label: 'Raw' },
]

const NAV_TITLES: Record<PulseNav, string> = {
  home: 'HOME // CITY FEED',
  discover: 'DISCOVER // PUBLIC SIGNALS',
  bookmarks: 'BOOKMARKS',
  notifications: 'NOTIFICATIONS',
  profile: 'PROFILE',
}

interface PulseAppProps {
  readonly onNotice: (message: string) => void
  readonly activeIdentity: NetActiveIdentityState
  readonly accountResolution: NetAppAccountResolution
  readonly accounts: readonly NetAppAccount[]
  readonly accountSessionKey: string | null
  readonly contentSessionKey: string | null
  readonly compromisedSession: NetCompromisedPulseSession
  readonly networkAuthorityLabel?: string
  readonly onContextMismatch: () => void
  readonly onActivateAccount: (input: {
    readonly handle: string
    readonly profile: PulseProfileDraft
  }) => Promise<string>
}

interface PulseLocalState {
  readonly ownerKey: string | null
  readonly followOverrides: Readonly<Record<string, boolean>>
  readonly postInteractions: Readonly<Record<string, {
    readonly reactedByMe?: boolean
    readonly boostedByMe?: boolean
    readonly bookmarkedByMe?: boolean
  }>>
}

function createPulseLocalState(ownerKey: string | null): PulseLocalState {
  return {
    ownerKey,
    followOverrides: {},
    postInteractions: {},
  }
}

function adaptPulseAccountSummary(summary: NetPulseAccountSummary): PulseAccount {
  return {
    id: summary.accountId,
    displayName: `@${summary.handle}`,
    handle: summary.handle,
    bio: summary.bio,
    kind: 'citizen',
    verified: false,
    followers: summary.followers,
    following: summary.following,
    pulses: summary.pulses,
    viewerFollowing: summary.viewerFollowing,
    visibility: summary.visibility,
    discoverable: summary.discoverable,
    ...(summary.avatarUrl ? { avatarUrl: summary.avatarUrl } : {}),
  }
}

interface ThreadViewProps {
  post: PulsePostData
  author: PulseAccount
  quoted: { post: PulsePostData; author: PulseAccount } | null
  replies: PulsePostData[]
  accountsById: Map<string, PulseAccount>
  replyDraft: string
  canAuthor: boolean
  compromisedHandle?: string
  readOnlyEngagement: boolean
  submitting: boolean
  hasMoreReplies: boolean
  loadingMoreReplies: boolean
  pageLoadFailed: boolean
  onReplyDraftChange: (value: string) => void
  onSubmitReply: () => void
  onLoadMoreReplies: () => void
  onRequireAccount: () => void
  onBack: () => void
  onOpenThread: (id: string) => void
  onOpenProfile: (id: string) => void
  onReact: (id: string) => void
  onBoost: (id: string) => void
  onBookmark: (id: string) => void
  onDistrictClick: (district: string) => void
  onTopicClick: (topic: string) => void
  getDeleteMode: (post: PulsePostData) => PulseDeleteMode | null
  onRequestDelete: (post: PulsePostData, mode: PulseDeleteMode) => void
  isInteractionPending: (postId: string, action: 'reaction' | 'boost' | 'bookmark') => boolean
}

function ThreadView({
  post,
  author,
  quoted,
  replies,
  accountsById,
  replyDraft,
  canAuthor,
  compromisedHandle,
  readOnlyEngagement,
  submitting,
  hasMoreReplies,
  loadingMoreReplies,
  pageLoadFailed,
  onReplyDraftChange,
  onSubmitReply,
  onLoadMoreReplies,
  onRequireAccount,
  onBack,
  onOpenThread,
  onOpenProfile,
  onReact,
  onBoost,
  onBookmark,
  onDistrictClick,
  onTopicClick,
  getDeleteMode,
  onRequestDelete,
  isInteractionPending,
}: ThreadViewProps) {
  const postDeleteMode = getDeleteMode(post)
  return (
    <div className="pulse-thread">
      <button type="button" className="pulse-back" onClick={onBack}>
        <ArrowLeft size={14} />
        Back
      </button>

      <PulsePost
        post={post}
        author={author}
        quoted={quoted}
        variant="thread"
        onOpenThread={onOpenThread}
        onOpenProfile={onOpenProfile}
        onReact={onReact}
        onBoost={onBoost}
        onBookmark={onBookmark}
        onDistrictClick={onDistrictClick}
        onTopicClick={onTopicClick}
        readOnlyActions={readOnlyEngagement}
        reactionPending={isInteractionPending(post.id, 'reaction')}
        boostPending={isInteractionPending(post.id, 'boost')}
        bookmarkPending={isInteractionPending(post.id, 'bookmark')}
        {...(postDeleteMode
          ? {
              onDelete: () => onRequestDelete(post, postDeleteMode),
              deleteLabel: 'Delete Pulse' as const,
              controlledDelete: postDeleteMode === 'compromised',
            }
          : {})}
      />

      {canAuthor || !readOnlyEngagement ? <form
        className="pulse-reply-composer"
        data-compromised={compromisedHandle ? 'true' : 'false'}
        aria-busy={submitting}
        onSubmit={(event) => {
          event.preventDefault()
          onSubmitReply()
        }}
      >
        {compromisedHandle ? (
          <div className="pulse-controlled-context" role="status">
            <ShieldAlert size={13} />
            <span><strong>COMPROMISED SESSION</strong> Posting through @{compromisedHandle} // audited</span>
          </div>
        ) : null}
        <textarea
          value={replyDraft}
          maxLength={MAX_CHARS}
          onChange={(event) => onReplyDraftChange(event.target.value)}
          onFocus={() => {
            if (!canAuthor) onRequireAccount()
          }}
          readOnly={!canAuthor}
          placeholder={canAuthor ? `Reply to @${author.handle}...` : 'A PULSE identity is required to reply.'}
          aria-label="Write a reply"
        />

        <button
          type={canAuthor ? 'submit' : 'button'}
          disabled={submitting || (canAuthor && !replyDraft.trim())}
          onClick={canAuthor ? undefined : onRequireAccount}
        >
          <Send size={13} />
          {submitting ? 'Sending…' : canAuthor ? 'Reply' : 'Set up identity'}
        </button>
      </form> : <p className="pulse-thread__read-only" role="status">PUBLIC THREAD // READ ONLY</p>}

      <div className="pulse-thread__replies">
        {replies.length === 0 ? (
          <p className="pulse-empty">No replies yet. Be the first to respond.</p>
        ) : (
          replies.map((reply) => {
            const replyAuthor = accountsById.get(reply.authorId)
            const replyDeleteMode = getDeleteMode(reply)

            if (!replyAuthor) {
              return null
            }

            return (
              <PulsePost
                key={reply.id}
                post={reply}
                author={replyAuthor}
                variant="reply"
                onOpenThread={onOpenThread}
                onOpenProfile={onOpenProfile}
                onReact={onReact}
                onBoost={onBoost}
                onBookmark={onBookmark}
                onDistrictClick={onDistrictClick}
                onTopicClick={onTopicClick}
                readOnlyActions={readOnlyEngagement}
                reactionPending={isInteractionPending(reply.id, 'reaction')}
                boostPending={isInteractionPending(reply.id, 'boost')}
                bookmarkPending={isInteractionPending(reply.id, 'bookmark')}
                {...(replyDeleteMode
                  ? {
                      onDelete: () => onRequestDelete(reply, replyDeleteMode),
                      deleteLabel: 'Delete reply' as const,
                      controlledDelete: replyDeleteMode === 'compromised',
                    }
                  : {})}
              />
            )
          })
        )}
      </div>
      <PulseLoadMore
        available={hasMoreReplies}
        pending={loadingMoreReplies}
        failed={pageLoadFailed}
        label="Load more replies"
        onLoad={onLoadMoreReplies}
      />
    </div>
  )
}

function PulseAccountGate({
  title,
  detail,
  action,
}: {
  readonly title: string
  readonly detail: string
  readonly action?: () => void
}) {
  return (
    <div className="pulse-account-gate" role="status">
      <Radio size={22} />
      <strong>{title}</strong>
      <p>{detail}</p>
      {action ? <button type="button" onClick={action}>Set up public profile</button> : null}
    </div>
  )
}

function PulseFeedEmptyState({
  title,
  detail,
  action,
}: {
  readonly title: string
  readonly detail: string
  readonly action?: { readonly label: string; readonly onClick: () => void }
}) {
  return (
    <div className="pulse-feed-empty" role="status">
      <Radio size={18} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
        {action ? (
          <button type="button" onClick={action.onClick}>{action.label}</button>
        ) : null}
      </div>
    </div>
  )
}

function PulseDeleteConfirmation({
  kind,
  pending,
  expired,
  compromised,
  error,
  onConfirm,
  onCancel,
}: {
  readonly kind: 'post' | 'reply'
  readonly pending: boolean
  readonly expired: boolean
  readonly compromised: boolean
  readonly error: string | null
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { confirmRef.current?.focus() }, [])

  return (
    <div
      className="pulse-delete-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel()
      }}
    >
      <section
        className="pulse-delete-confirm"
        data-compromised={compromised ? 'true' : 'false'}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pulse-delete-title"
        aria-describedby="pulse-delete-detail"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !pending) {
            event.stopPropagation()
            onCancel()
          }
        }}
      >
        <div>
          <strong id="pulse-delete-title">DELETE {kind === 'reply' ? 'REPLY' : 'PULSE'}?</strong>
          <p id="pulse-delete-detail">
            {expired
              ? 'The server deletion window has closed.'
              : compromised
                ? `This ${kind} will be removed through the current compromised session and audit logged.`
              : kind === 'reply'
                ? 'This reply will leave the public thread. Its creation audit remains intact.'
                : 'This Pulse and its visible reply branch will leave the public grid. Audit evidence remains intact.'}
          </p>
        </div>
        {error ? <p className="pulse-delete-confirm__error" role="alert">{error}</p> : null}
        <footer>
          <button type="button" onClick={onCancel} disabled={pending}>Keep {kind === 'reply' ? 'reply' : 'Pulse'}</button>
          <button ref={confirmRef} type="button" className="pulse-delete-confirm__primary" onClick={onConfirm} disabled={pending || expired}>
            {pending ? 'Deleting…' : compromised ? 'Delete through control' : `Delete ${kind === 'reply' ? 'reply' : 'Pulse'}`}
          </button>
        </footer>
      </section>
    </div>
  )
}

export function PulseApp({
  onNotice,
  activeIdentity,
  accountResolution,
  accounts,
  accountSessionKey,
  contentSessionKey,
  compromisedSession,
  networkAuthorityLabel = 'VEGA MESH',
  onContextMismatch,
  onActivateAccount,
}: PulseAppProps) {
  const currentIdentity = useMemo(
    () => createCurrentPulseIdentity({ activeIdentity, accountResolution }),
    [accountResolution, activeIdentity],
  )
  const currentAccountId = currentIdentity.status === 'ready'
    ? currentIdentity.identity.accountId
    : null
  const identitySessionKey = currentAccountId ?? accountSessionKey
  const publicationSessionKey = compromisedSession.status === 'ready'
    ? `compromised:${compromisedSession.identity.accountId}:${compromisedSession.sessionGeneration}`
    : compromisedSession.status === 'inactive'
      ? identitySessionKey
      : `compromised:${compromisedSession.status}`
  const [localState, setLocalState] = useState<PulseLocalState>(() =>
    createPulseLocalState(null),
  )
  const [nav, setNav] = useState<PulseNav>('home')
  const [feedTab, setFeedTab] = useState<PulseFeedTab>('city')
  const [searchQuery, setSearchQuery] = useState('')
  const [serverSearchQuery, setServerSearchQuery] = useState('')
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null)
  const [relationshipView, setRelationshipView] = useState<PulseRelationshipView | null>(null)
  const [relationshipRetryRevision, setRelationshipRetryRevision] = useState(0)
  const [draft, setDraft] = useState('')
  const [replyDraft, setReplyDraft] = useState('')
  const [composerFocusTick, setComposerFocusTick] = useState(0)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [profileEditing, setProfileEditing] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PulseDeleteTarget | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteClock, setDeleteClock] = useState(() => Date.now())
  const [pendingEngagementKeys, setPendingEngagementKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [notificationActionPending, setNotificationActionPending] = useState(false)
  const pendingEngagementRef = useRef<ReadonlySet<string>>(new Set())
  const navigationHistoryRef = useRef<PulseNavigationSnapshot[]>([])
  const lastContextMismatchAtRef = useRef(0)
  const requestContext = useMemo<NetPulseRequestContext>(() => ({
    expectedAccountId: currentAccountId,
    ...(compromisedSession.status === 'ready'
      ? {
          compromised: {
            expectedAccountId: compromisedSession.identity.accountId,
            expectedSessionGeneration: compromisedSession.sessionGeneration,
          },
        }
      : {}),
  }), [compromisedSession, currentAccountId])
  const handleContextMismatch = useCallback((error: Error) => {
    const now = Date.now()
    if (now - lastContextMismatchAtRef.current <= 800) return
    lastContextMismatchAtRef.current = now
    setLocalState(createPulseLocalState(null))
    pendingEngagementRef.current = new Set()
    setPendingEngagementKeys(new Set())
    onContextMismatch()
    onNotice(`PULSE // ${error.message}`)
  }, [onContextMismatch, onNotice])
  const activeLocalState = localState.ownerKey === identitySessionKey
    ? localState
    : createPulseLocalState(identitySessionKey)
  const viewerContextPending = compromisedSession.status === 'inactive'
    && currentIdentity.status === 'loading'
  const realtimeSessionKey = contentSessionKey && !viewerContextPending
    ? `${contentSessionKey}:${publicationSessionKey ?? 'public'}`
    : null
  const profileAccountId = currentAccountId ?? (
    compromisedSession.status === 'ready' ? compromisedSession.identity.accountId : null
  )
  const trimmedQuery = searchQuery.trim()
  const normalizedServerSearchQuery = serverSearchQuery.trim()
  const searchPending = trimmedQuery !== normalizedServerSearchQuery
  useEffect(() => {
    const timer = window.setTimeout(() => setServerSearchQuery(trimmedQuery), 240)
    return () => window.clearTimeout(timer)
  }, [trimmedQuery])
  const activeContentQuery = useMemo<NetPulseContentQuery | null>(() => {
    if (relationshipView) return null
    if (selectedPostId) {
      const rootPostId = getPulseServerPostId(selectedPostId)
      return rootPostId ? { mode: 'thread', rootPostId } : null
    }
    if (viewingProfileId) return { mode: 'profile', accountId: viewingProfileId }
    if (nav === 'profile') {
      return profileAccountId ? { mode: 'profile', accountId: profileAccountId } : null
    }
    if (trimmedQuery) {
      return searchPending || normalizedServerSearchQuery.length < 3
        ? null
        : { mode: 'search', query: normalizedServerSearchQuery }
    }
    if (nav === 'bookmarks') return { mode: 'bookmarks' }
    if (nav === 'notifications') return null
    if (nav === 'discover') return { mode: 'discover' }
    if (feedTab === 'following') return { mode: 'following' }
    if (feedTab === 'raw') return { mode: 'raw' }
    return { mode: 'city' }
  }, [
    feedTab,
    nav,
    profileAccountId,
    relationshipView,
    normalizedServerSearchQuery,
    searchPending,
    selectedPostId,
    trimmedQuery,
    viewingProfileId,
  ])
  const pulseContent = useNetPulseContent(
    realtimeSessionKey,
    activeContentQuery,
    requestContext,
    handleContextMismatch,
  )
  const notificationViewerAccountId = compromisedSession.status === 'inactive'
    ? currentAccountId
    : null
  const pulseNotifications = useNetPulseNotifications({
    viewerAccountId: notificationViewerAccountId,
    open: nav === 'notifications',
    notificationRevision: pulseContent.revisions.notifications,
    profileRevision: pulseContent.revisions.profile,
    invalidatedPostId: pulseContent.revisions.lastOperation === 'soft-delete'
      ? pulseContent.revisions.lastResourceId
      : null,
    onContextMismatch: handleContextMismatch,
  })
  const serverRuntime = useMemo(
    () => adaptNetPulseFeed(pulseContent.state.feed),
    [pulseContent.state.feed],
  )
  const posts = useMemo(
    () => serverRuntime.posts.map((post) => {
      const interaction = activeLocalState.postInteractions[post.id]
      const viewerFollowsAuthor = activeLocalState.followOverrides[post.authorId]
        ?? post.viewerFollowsAuthor
      if (!interaction) return { ...post, viewerFollowsAuthor }
      const reactedByMe = interaction.reactedByMe ?? post.reactedByMe
      const boostedByMe = interaction.boostedByMe ?? post.boostedByMe
      return {
        ...post,
        viewerFollowsAuthor,
        ...interaction,
        reactions: post.reactions
          + (reactedByMe ? 1 : 0)
          - (post.reactedByMe ? 1 : 0),
        boosts: post.boosts
          + (boostedByMe ? 1 : 0)
          - (post.boostedByMe ? 1 : 0),
      }
    }),
    [activeLocalState.followOverrides, activeLocalState.postInteractions, serverRuntime.posts],
  )
  const profileFallbackHandle = currentIdentity.status === 'ready'
    ? currentIdentity.identity.displayHandle.replace(/^@/, '')
    : compromisedSession.status === 'ready'
      ? compromisedSession.identity.displayHandle.replace(/^@/, '')
      : undefined
  const profileControlMode = currentAccountId
    ? 'owner' as const
    : compromisedSession.status === 'ready'
      ? 'compromised' as const
      : 'read-only' as const
  const pulseProfile = useNetPulseProfile(
    profileAccountId,
    profileFallbackHandle,
    profileControlMode,
    pulseContent.revisions.profile,
    requestContext,
    handleContextMismatch,
  )
  const profileSession = pulseProfile.state.status === 'ready'
    && pulseProfile.state.profile.accountId === profileAccountId
    ? pulseProfile.state.profile
    : undefined
  const directoryRevision = pulseContent.revision
  const profileAccountSummary = useNetPulseAccountSummary(
    profileAccountId,
    directoryRevision,
    currentAccountId,
    handleContextMismatch,
  )
  const accountSearch = useNetPulseAccountSearch(
    searchQuery,
    realtimeSessionKey,
    directoryRevision,
    currentAccountId,
    handleContextMismatch,
  )
  const discoverAccounts = useNetPulseDiscoverAccounts(
    realtimeSessionKey,
    directoryRevision,
    nav === 'discover' && !selectedPostId && !viewingProfileId && !relationshipView,
    currentAccountId,
    handleContextMismatch,
  )
  const relationshipAccounts = useNetPulseRelationshipAccounts(
    relationshipView?.profileAccountId ?? null,
    relationshipView?.direction ?? null,
    realtimeSessionKey,
    directoryRevision + relationshipRetryRevision,
    currentAccountId,
    handleContextMismatch,
  )
  const viewingProfileFallbackHandle = viewingProfileId
    ? serverRuntime.accounts.find((account) => account.id === viewingProfileId)?.handle
      ?? accountSearch.results.find((account) => account.accountId === viewingProfileId)?.handle
      ?? discoverAccounts.results.find((account) => account.accountId === viewingProfileId)?.handle
      ?? relationshipAccounts.results.find((account) => account.accountId === viewingProfileId)?.handle
      ?? pulseNotifications.state.notifications.find(
        (notification) => notification.actorAccountId === viewingProfileId,
      )?.actorHandle
      ?? serverRuntime.posts.flatMap((post) => post.mentions ?? []).find(
        (mention) => mention.accountId === viewingProfileId,
      )?.currentHandle
    : undefined
  const viewedPulseProfile = useNetPulseProfile(
    viewingProfileId && viewingProfileId !== profileAccountId ? viewingProfileId : null,
    viewingProfileFallbackHandle,
    'read-only',
    pulseContent.revisions.profile,
    requestContext,
    handleContextMismatch,
  )
  const viewedAccountSummary = useNetPulseAccountSummary(
    viewingProfileId && viewingProfileId !== currentAccountId ? viewingProfileId : null,
    directoryRevision,
    currentAccountId,
    handleContextMismatch,
  )
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const contentErrorRef = useRef<string | null>(null)
  const profileErrorRef = useRef<string | null>(null)
  const engagementDirectoryErrorRef = useRef<string | null>(null)

  const setFollowOverride = (accountId: string, following?: boolean) => {
    setLocalState((previous) => {
      const current = previous.ownerKey === identitySessionKey
        ? previous
        : createPulseLocalState(identitySessionKey)
      const next = { ...current.followOverrides }
      if (following === undefined) delete next[accountId]
      else next[accountId] = following
      return { ...current, followOverrides: next }
    })
  }

  const setPostInteraction = (
    postId: string,
    update: (previous: {
      readonly reactedByMe?: boolean
      readonly boostedByMe?: boolean
      readonly bookmarkedByMe?: boolean
    }) => {
      readonly reactedByMe?: boolean
      readonly boostedByMe?: boolean
      readonly bookmarkedByMe?: boolean
    },
  ) => {
    setLocalState((previous) => {
      const current = previous.ownerKey === identitySessionKey
        ? previous
        : createPulseLocalState(identitySessionKey)
      return {
        ...current,
        postInteractions: {
          ...current.postInteractions,
          [postId]: update(current.postInteractions[postId] ?? {}),
        },
      }
    })
  }

  const clearPostInteraction = (
    postId: string,
    field: 'reactedByMe' | 'boostedByMe' | 'bookmarkedByMe',
  ) => {
    setLocalState((previous) => {
      if (previous.ownerKey !== identitySessionKey) return previous
      const existing = previous.postInteractions[postId]
      if (!existing || !(field in existing)) return previous
      const nextInteraction = { ...existing }
      delete nextInteraction[field]
      const nextInteractions = { ...previous.postInteractions }
      if (Object.keys(nextInteraction).length === 0) delete nextInteractions[postId]
      else nextInteractions[postId] = nextInteraction
      return { ...previous, postInteractions: nextInteractions }
    })
  }

  const beginEngagement = (key: string): boolean => {
    if (pendingEngagementRef.current.has(key)) return false
    const next = new Set(pendingEngagementRef.current)
    next.add(key)
    pendingEngagementRef.current = next
    setPendingEngagementKeys(next)
    return true
  }

  const endEngagement = (key: string) => {
    const next = new Set(pendingEngagementRef.current)
    next.delete(key)
    pendingEngagementRef.current = next
    setPendingEngagementKeys(next)
  }

  useEffect(() => {
    setLocalState(createPulseLocalState(identitySessionKey))
    pendingEngagementRef.current = new Set()
    setPendingEngagementKeys(new Set())
    setNotificationActionPending(false)
    setDraft('')
    setReplyDraft('')
    setNav('home')
    setSearchQuery('')
    setSelectedPostId(null)
    setViewingProfileId(null)
    setRelationshipView(null)
    setRelationshipRetryRevision(0)
    navigationHistoryRef.current = []
    setOnboardingOpen(false)
    setProfileEditing(false)
    setDeleteTarget(null)
    setDeleteError(null)
  }, [identitySessionKey, publicationSessionKey])

  useEffect(() => {
    if (!currentAccountId) return undefined
    const timer = window.setInterval(() => setDeleteClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [currentAccountId])

  useEffect(() => {
    if (pulseProfile.state.status !== 'ready' || currentAccountId !== pulseProfile.state.profile.accountId) return
    setFeedTab(pulseProfile.state.profile.defaultFeed)
  }, [currentAccountId, pulseProfile.state])

  useEffect(() => {
    if (pulseContent.state.status !== 'error') {
      contentErrorRef.current = null
      return
    }
    if (contentErrorRef.current === pulseContent.state.reason) return
    contentErrorRef.current = pulseContent.state.reason
    onNotice(`PULSE // ${pulseContent.state.reason}`)
  }, [onNotice, pulseContent.state])

  useEffect(() => {
    if (pulseProfile.state.status !== 'error') {
      profileErrorRef.current = null
      return
    }
    if (profileErrorRef.current === pulseProfile.state.reason) return
    profileErrorRef.current = pulseProfile.state.reason
    onNotice(`PULSE PROFILE // ${pulseProfile.state.reason}`)
  }, [onNotice, pulseProfile.state])

  useEffect(() => {
    const reason = accountSearch.status === 'error'
      ? accountSearch.reason
      : discoverAccounts.status === 'error'
        ? discoverAccounts.reason
        : relationshipAccounts.status === 'error'
          ? relationshipAccounts.reason
          : profileAccountSummary.status === 'error'
            ? profileAccountSummary.reason
            : viewedAccountSummary.status === 'error'
              ? viewedAccountSummary.reason
              : null
    if (!reason) {
      engagementDirectoryErrorRef.current = null
      return
    }
    if (engagementDirectoryErrorRef.current === reason) return
    engagementDirectoryErrorRef.current = reason
    onNotice(`PULSE SOCIAL GRAPH // ${reason}`)
  }, [accountSearch, discoverAccounts, onNotice, profileAccountSummary, relationshipAccounts, viewedAccountSummary])

  useEffect(() => {
    setLocalState((previous) => {
      if (previous.ownerKey !== identitySessionKey) return previous
      let changed = false
      const basePostsById = new Map(serverRuntime.posts.map((post) => [post.id, post]))
      const nextInteractions = { ...previous.postInteractions }
      for (const [postId, override] of Object.entries(previous.postInteractions)) {
        const base = basePostsById.get(postId)
        // A bounded surface not containing this post says nothing about its
        // authoritative viewer state. Keep the cross-surface optimistic overlay
        // until a surface containing the UUID confirms it (important when an
        // unbookmarked post disappears from the Bookmarks response).
        if (!base) continue
        const next = { ...override }
        if (next.reactedByMe === base.reactedByMe) delete next.reactedByMe
        if (next.boostedByMe === base.boostedByMe) delete next.boostedByMe
        if (next.bookmarkedByMe === base.bookmarkedByMe) delete next.bookmarkedByMe
        if (Object.keys(next).length !== Object.keys(override).length) changed = true
        if (Object.keys(next).length === 0) delete nextInteractions[postId]
        else nextInteractions[postId] = next
      }

      const baseFollowing = new Map(
        serverRuntime.accounts.map((account) => [account.id, account.viewerFollowing ?? false]),
      )
      if (profileAccountSummary.status === 'ready' && profileAccountSummary.summary) {
        baseFollowing.set(profileAccountSummary.summary.accountId, profileAccountSummary.summary.viewerFollowing)
      }
      if (viewedAccountSummary.status === 'ready' && viewedAccountSummary.summary) {
        baseFollowing.set(viewedAccountSummary.summary.accountId, viewedAccountSummary.summary.viewerFollowing)
      }
      for (const summary of accountSearch.results) {
        baseFollowing.set(summary.accountId, summary.viewerFollowing)
      }
      for (const summary of discoverAccounts.results) {
        baseFollowing.set(summary.accountId, summary.viewerFollowing)
      }
      for (const summary of relationshipAccounts.results) {
        baseFollowing.set(summary.accountId, summary.viewerFollowing)
      }
      const nextFollows = { ...previous.followOverrides }
      for (const [accountId, desired] of Object.entries(previous.followOverrides)) {
        if (baseFollowing.get(accountId) === desired) {
          delete nextFollows[accountId]
          changed = true
        }
      }
      return changed
        ? { ...previous, postInteractions: nextInteractions, followOverrides: nextFollows }
        : previous
    })
  }, [
    accountSearch.results,
    discoverAccounts.results,
    identitySessionKey,
    profileAccountSummary,
    serverRuntime.accounts,
    serverRuntime.posts,
    relationshipAccounts.results,
    viewedAccountSummary,
  ])

  const currentPulseAccount = useMemo<PulseAccount | null>(() => {
    if (currentIdentity.status !== 'ready') return null
    const summary = profileAccountSummary.status === 'ready'
      && profileAccountSummary.summary?.accountId === currentIdentity.identity.accountId
      ? profileAccountSummary.summary
      : null
    const handle = profileSession?.handle ?? currentIdentity.identity.displayHandle.replace(/^@/, '')
    const avatarUrl = summary?.avatarUrl ?? currentIdentity.identity.avatarUrl
    return {
      id: currentIdentity.identity.accountId,
      displayName: `@${handle}`,
      handle,
      bio: profileSession?.bio ?? summary?.bio ?? '',
      kind: 'citizen',
      verified: false,
      followers: summary?.followers ?? 0,
      following: summary?.following ?? 0,
      pulses: summary?.pulses ?? 0,
      viewerFollowing: false,
      visibility: profileSession?.visibility ?? summary?.visibility ?? 'limited',
      discoverable: profileSession?.discoverable ?? summary?.discoverable ?? false,
      ...(avatarUrl ? { avatarUrl } : {}),
    }
  }, [
    currentIdentity,
    profileAccountSummary,
    profileSession?.bio,
    profileSession?.discoverable,
    profileSession?.handle,
    profileSession?.visibility,
  ])

  const compromisedPulseAccount = useMemo<PulseAccount | null>(() => {
    if (compromisedSession.status !== 'ready') return null
    const summary = profileAccountSummary.status === 'ready'
      && profileAccountSummary.summary?.accountId === compromisedSession.identity.accountId
      ? profileAccountSummary.summary
      : null
    const handle = profileSession?.handle ?? compromisedSession.identity.displayHandle.replace(/^@/, '')
    const avatarUrl = summary?.avatarUrl ?? compromisedSession.identity.avatarUrl
    return {
      id: compromisedSession.identity.accountId,
      displayName: `@${handle}`,
      handle,
      bio: profileSession?.bio ?? summary?.bio ?? '',
      kind: 'citizen',
      verified: false,
      followers: summary?.followers ?? 0,
      following: summary?.following ?? 0,
      pulses: summary?.pulses ?? 0,
      viewerFollowing: false,
      visibility: profileSession?.visibility ?? summary?.visibility ?? 'limited',
      discoverable: profileSession?.discoverable ?? summary?.discoverable ?? false,
      ...(avatarUrl ? { avatarUrl } : {}),
    }
  }, [
    compromisedSession,
    profileAccountSummary,
    profileSession?.bio,
    profileSession?.discoverable,
    profileSession?.handle,
    profileSession?.visibility,
  ])

  const publishingPulseAccount = currentPulseAccount ?? compromisedPulseAccount
  const isCompromisedAuthoring = !currentPulseAccount && Boolean(compromisedPulseAccount)
  const publishingAccountIdRef = useRef<string | null>(publishingPulseAccount?.id ?? null)
  publishingAccountIdRef.current = publishingPulseAccount?.id ?? null

  const allAccounts = useMemo(
    () => {
      const accountsById = new Map(
        serverRuntime.accounts.map((account) => [account.id, account]),
      )
      for (const summary of accountSearch.results) {
        accountsById.set(summary.accountId, adaptPulseAccountSummary(summary))
      }
      for (const summary of discoverAccounts.results) {
        accountsById.set(summary.accountId, adaptPulseAccountSummary(summary))
      }
      for (const summary of relationshipAccounts.results) {
        accountsById.set(summary.accountId, adaptPulseAccountSummary(summary))
      }
      for (const notification of pulseNotifications.state.notifications) {
        if (accountsById.has(notification.actorAccountId)) continue
        accountsById.set(notification.actorAccountId, {
          id: notification.actorAccountId,
          displayName: `@${notification.actorHandle}`,
          handle: notification.actorHandle,
          bio: '',
          kind: 'citizen',
          verified: false,
          followers: 0,
          following: 0,
          pulses: 0,
          viewerFollowing: false,
          visibility: 'limited',
          discoverable: false,
          ...(notification.actorAvatarUrl ? { avatarUrl: notification.actorAvatarUrl } : {}),
        })
      }
      for (const post of serverRuntime.posts) {
        for (const mention of post.mentions ?? []) {
          if (accountsById.has(mention.accountId)) continue
          accountsById.set(mention.accountId, {
            id: mention.accountId,
            displayName: `@${mention.currentHandle}`,
            handle: mention.currentHandle,
            bio: '',
            kind: 'citizen',
            verified: false,
            followers: 0,
            following: 0,
            pulses: 0,
            viewerFollowing: false,
            visibility: 'limited',
            discoverable: false,
          })
        }
      }
      if (viewedAccountSummary.status === 'ready' && viewedAccountSummary.summary) {
        accountsById.set(
          viewedAccountSummary.summary.accountId,
          adaptPulseAccountSummary(viewedAccountSummary.summary),
        )
      }
      if (currentPulseAccount) accountsById.set(currentPulseAccount.id, currentPulseAccount)
      if (compromisedPulseAccount) accountsById.set(compromisedPulseAccount.id, compromisedPulseAccount)
      return [...accountsById.values()].map((account) => {
        const override = activeLocalState.followOverrides[account.id]
        if (override === undefined) return account
        const base = account.viewerFollowing ?? false
        return {
          ...account,
          viewerFollowing: override,
          followers: Math.max(0, account.followers + (override ? 1 : 0) - (base ? 1 : 0)),
        }
      })
    },
    [
      accountSearch.results,
      activeLocalState.followOverrides,
      compromisedPulseAccount,
      currentPulseAccount,
      discoverAccounts.results,
      relationshipAccounts.results,
      pulseNotifications.state.notifications,
      serverRuntime.accounts,
      serverRuntime.posts,
      viewedAccountSummary,
    ],
  )
  const accountsById = useMemo(
    () => new Map(allAccounts.map((account) => [account.id, account])),
    [allAccounts],
  )
  const followedIds = useMemo(
    () => new Set(allAccounts.filter((account) => account.viewerFollowing).map((account) => account.id)),
    [allAccounts],
  )
  const postsById = useMemo(
    () => new Map(posts.map((post) => [post.id, post])),
    [posts],
  )
  const homePosts = useMemo(
    () => posts.filter((post) => !post.replyToPostId),
    [posts],
  )
  const orderServerPostsNewestFirst = (candidates: readonly PulsePostData[]) => (
    [...candidates].sort(
      (left, right) => Date.parse(right.serverCreatedAt ?? '') - Date.parse(left.serverCreatedAt ?? ''),
    )
  )
  const orderFollowingPosts = (candidates: readonly PulsePostData[]) => (
    [...candidates].sort((left, right) => Date.parse(
      right.followingActivityAt ?? right.serverCreatedAt ?? '',
    ) - Date.parse(left.followingActivityAt ?? left.serverCreatedAt ?? ''))
  )
  const canOwnerInteract = currentIdentity.status === 'ready' && Boolean(currentPulseAccount)
  const canOfferOwnerEngagement = compromisedSession.status === 'inactive'
    && (currentIdentity.status === 'ready' || currentIdentity.status === 'needs-onboarding')
  const canPublish = canOwnerInteract || isCompromisedAuthoring
  const getDeleteMode = (post: PulsePostData): PulseDeleteMode | null => {
    if (!post.serverPostId) return null
    if (isCompromisedAuthoring && compromisedPulseAccount) {
      return post.authorId === compromisedPulseAccount.id ? 'compromised' : null
    }
    if (!currentPulseAccount || !post.serverCreatedAt) return null
    const createdAt = Date.parse(post.serverCreatedAt)
    return post.authorId === currentPulseAccount.id
      && Number.isFinite(createdAt)
      && deleteClock <= createdAt + 10 * 60_000
      ? 'owner'
      : null
  }
  const composerPlaceholder = canPublish
    ? 'Say something to the city...'
    : compromisedSession.status === 'loading'
      ? 'Resolving compromised PULSE account...'
      : compromisedSession.status === 'unavailable'
        ? compromisedSession.code === 'no-account'
          ? 'Target has no PULSE account.'
          : 'Compromised target is unavailable.'
        : 'Create a PULSE identity to post.'
  const composerActionLabel = compromisedSession.status === 'loading'
    ? 'Resolving'
    : compromisedSession.status === 'unavailable'
      ? 'Unavailable'
      : 'Create identity'

  useEffect(() => {
    if (nav === 'home' && !selectedPostId && !viewingProfileId && canPublish) {
      composerRef.current?.focus()
    }
  }, [canPublish, composerFocusTick, nav, selectedPostId, viewingProfileId])
  const publishingPulseAuthor = useMemo<NetPulsePublicAuthor | null>(() =>
    publishingPulseAccount
      ? {
          accountId: publishingPulseAccount.id,
          handle: publishingPulseAccount.handle,
          displayName: `@${publishingPulseAccount.handle}`,
          ...(publishingPulseAccount.avatarUrl ? { avatarUrl: publishingPulseAccount.avatarUrl } : {}),
          status: 'active',
          bio: publishingPulseAccount.bio,
          followers: publishingPulseAccount.followers,
          following: publishingPulseAccount.following,
          pulses: publishingPulseAccount.pulses ?? 0,
          viewerFollowing: false,
          visibility: publishingPulseAccount.visibility ?? 'limited',
          discoverable: publishingPulseAccount.discoverable ?? false,
        }
      : null,
  [publishingPulseAccount])

  const requestPersonalIdentity = () => {
    if (compromisedSession.status !== 'inactive') {
      onNotice('COMPROMISED SESSION // PULSE ACCOUNT SETTINGS REMAIN UNAVAILABLE')
      return false
    }
    if (currentIdentity.status === 'needs-onboarding') {
      setOnboardingOpen(true)
      setNav('profile')
      setSelectedPostId(null)
      setViewingProfileId(null)
      setRelationshipView(null)
      return false
    }

    const detail = currentIdentity.status === 'gm-no-persona'
      ? 'NO ACTIVE PERSONA // public browsing remains available.'
      : currentIdentity.status === 'loading'
        ? 'PULSE // IDENTITY SYNCHRONIZATION IN PROGRESS'
        : currentIdentity.status === 'restricted'
          ? `PULSE // ${currentIdentity.message}`
          : 'PULSE // A FICTIONAL IDENTITY IS REQUIRED'
    onNotice(detail)
    return false
  }

  const requestPublishingIdentity = () => {
    if (compromisedSession.status === 'loading') {
      onNotice('PULSE // RESOLVING COMPROMISED TARGET ACCOUNT')
      return false
    }
    if (compromisedSession.status === 'unavailable') {
      onNotice(compromisedSession.code === 'no-account'
        ? 'PULSE // TARGET HAS NO PULSE ACCOUNT'
        : `PULSE // ${compromisedSession.reason}`)
      return false
    }
    return requestPersonalIdentity()
  }

  const requirePublishingIdentity = () => canPublish || requestPublishingIdentity()
  const requirePulseAccount = () => {
    if (canOwnerInteract) return true
    if (compromisedSession.status !== 'inactive') {
      onNotice('COMPROMISED SESSION // POSTS AND REPLIES ONLY')
      return false
    }
    return requestPersonalIdentity()
  }

  const captureNavigation = (): PulseNavigationSnapshot => ({
    nav,
    selectedPostId,
    viewingProfileId,
    relationshipView,
    searchQuery,
  })
  const pushNavigation = () => {
    navigationHistoryRef.current = [...navigationHistoryRef.current, captureNavigation()]
  }
  const navigateBack = () => {
    const history = navigationHistoryRef.current
    const previous = history.at(-1)
    navigationHistoryRef.current = previous ? history.slice(0, -1) : []
    setProfileEditing(false)
    setOnboardingOpen(false)
    if (!previous) {
      setNav('home')
      setSelectedPostId(null)
      setViewingProfileId(null)
      setRelationshipView(null)
      setSearchQuery('')
      return
    }
    setNav(previous.nav)
    setSelectedPostId(previous.selectedPostId)
    setViewingProfileId(previous.viewingProfileId)
    setRelationshipView(previous.relationshipView)
    setSearchQuery(previous.searchQuery)
  }
  const openThread = (id: string) => {
    let rootId = id
    let candidate = postsById.get(rootId)
    const visited = new Set<string>()
    while (candidate?.replyToPostId && !visited.has(candidate.id)) {
      visited.add(candidate.id)
      rootId = candidate.replyToPostId
      candidate = postsById.get(rootId)
    }
    if (selectedPostId === rootId && !viewingProfileId && !relationshipView) return
    pushNavigation()
    setSelectedPostId(rootId)
    setViewingProfileId(null)
    setRelationshipView(null)
    setReplyDraft('')
  }
  const openProfile = (accountId: string) => {
    const opensSessionProfile = accountId === currentPulseAccount?.id
      || accountId === compromisedPulseAccount?.id
    if ((opensSessionProfile && nav === 'profile' && !viewingProfileId)
      || viewingProfileId === accountId) return
    pushNavigation()
    setNav(opensSessionProfile ? 'profile' : nav)
    setViewingProfileId(opensSessionProfile ? null : accountId)
    setSelectedPostId(null)
    setRelationshipView(null)
    setProfileEditing(false)
  }
  const openRelationships = (
    profileAccountId: string,
    direction: NetPulseRelationshipDirection,
  ) => {
    const profile = accountsById.get(profileAccountId)
    if (!profile) {
      onNotice('PULSE // PUBLIC PROFILE PRESENTATION IS UNAVAILABLE')
      return
    }
    pushNavigation()
    setSelectedPostId(null)
    setViewingProfileId(null)
    setRelationshipView({ profileAccountId, direction, profile })
    setProfileEditing(false)
  }
  const handleNavClick = (id: PulseNav) => {
    // Account onboarding may gate personal actions; it must never trap public navigation.
    if (id !== 'profile') setOnboardingOpen(false)
    navigationHistoryRef.current = []
    setProfileEditing(false)
    setRelationshipView(null)
    if (id === 'notifications' && !notificationViewerAccountId) {
      if (compromisedSession.status !== 'inactive') {
        onNotice('COMPROMISED SESSION // PRIVATE NOTIFICATIONS REMAIN UNAVAILABLE')
      } else {
        requestPersonalIdentity()
      }
      return
    }
    if (id === 'profile' && !canOwnerInteract) {
      setNav('profile')
      setSelectedPostId(null)
      setViewingProfileId(null)
      setSearchQuery('')
      if (isCompromisedAuthoring) return
      requestPersonalIdentity()
      return
    }
    setNav(id)
    setSelectedPostId(null)
    setViewingProfileId(null)
    setSearchQuery('')
  }
  const handleCreatePulseClick = () => {
    if (!requirePublishingIdentity()) return
    setNav('home')
    navigationHistoryRef.current = []
    setSelectedPostId(null)
    setViewingProfileId(null)
    setRelationshipView(null)
    setSearchQuery('')
    setComposerFocusTick((tick) => tick + 1)
  }
  const setDistrictFilter = (district: string) => {
    pushNavigation()
    setNav('home')
    setSelectedPostId(null)
    setViewingProfileId(null)
    setRelationshipView(null)
    setSearchQuery(district)
    onNotice(`PULSE // FILTERING DISTRICT ${district.toUpperCase()}`)
  }
  const setTopicFilter = (topic: string) => {
    pushNavigation()
    setNav('home')
    setSelectedPostId(null)
    setViewingProfileId(null)
    setRelationshipView(null)
    setSearchQuery(topic)
    onNotice(`PULSE // FILTERING #${topic.toUpperCase()}`)
  }

  const isInteractionPending = (
    postId: string,
    action: 'reaction' | 'boost' | 'bookmark',
  ) => pendingEngagementKeys.has(`${action}:${postId}`)
  const pendingFollowIds = useMemo(() => new Set(
    [...pendingEngagementKeys]
      .filter((key) => key.startsWith('follow:'))
      .map((key) => key.slice('follow:'.length)),
  ), [pendingEngagementKeys])

  const toggleReaction = async (postId: string) => {
    if (!requirePulseAccount()) return
    const expectedAccountId = currentAccountId
    if (!expectedAccountId) return
    const target = postsById.get(postId)
    if (!target?.serverPostId) return
    const pendingKey = `reaction:${postId}`
    if (!beginEngagement(pendingKey)) return
    const willReact = !target.reactedByMe
    const targetAccount = accountsById.get(target.authorId)
    const targetLabel = targetAccount ? `@${targetAccount.handle}` : 'PULSE'
    setPostInteraction(postId, (previous) => ({ ...previous, reactedByMe: willReact }))
    try {
      await setNetPulseReaction(target.serverPostId, willReact, expectedAccountId)
      onNotice(willReact ? `REACTED // ${targetLabel}` : `REACTION REMOVED // ${targetLabel}`)
    } catch (error) {
      clearPostInteraction(postId, 'reactedByMe')
      if (isNetPulseContextChangedError(error)) {
        handleContextMismatch(error)
      } else {
        onNotice(error instanceof Error ? `PULSE // ${error.message}` : 'PULSE // REACTION FAILED')
      }
    } finally {
      endEngagement(pendingKey)
    }
  }
  const toggleBoost = async (postId: string) => {
    if (!requirePulseAccount()) return
    const expectedAccountId = currentAccountId
    if (!expectedAccountId) return
    const target = postsById.get(postId)
    if (!target?.serverPostId || target.replyToPostId) return
    const pendingKey = `boost:${postId}`
    if (!beginEngagement(pendingKey)) return
    const willBoost = !target.boostedByMe
    const targetAccount = accountsById.get(target.authorId)
    const targetLabel = targetAccount ? `@${targetAccount.handle}` : 'PULSE'
    setPostInteraction(postId, (previous) => ({ ...previous, boostedByMe: willBoost }))
    try {
      await setNetPulseBoost(target.serverPostId, willBoost, expectedAccountId)
      onNotice(willBoost ? `BOOSTED // ${targetLabel}` : `BOOST REMOVED // ${targetLabel}`)
    } catch (error) {
      clearPostInteraction(postId, 'boostedByMe')
      if (isNetPulseContextChangedError(error)) {
        handleContextMismatch(error)
      } else {
        onNotice(error instanceof Error ? `PULSE // ${error.message}` : 'PULSE // BOOST FAILED')
      }
    } finally {
      endEngagement(pendingKey)
    }
  }
  const toggleBookmark = async (postId: string) => {
    if (!requirePulseAccount()) return
    const expectedAccountId = currentAccountId
    if (!expectedAccountId) return
    const target = postsById.get(postId)
    if (!target?.serverPostId) return
    const pendingKey = `bookmark:${postId}`
    if (!beginEngagement(pendingKey)) return
    const willBookmark = !target.bookmarkedByMe
    setPostInteraction(postId, (previous) => ({ ...previous, bookmarkedByMe: willBookmark }))
    try {
      await setNetPulseBookmark(target.serverPostId, willBookmark, expectedAccountId)
      onNotice(willBookmark ? 'PULSE // SAVED TO BOOKMARKS' : 'PULSE // REMOVED FROM BOOKMARKS')
    } catch (error) {
      clearPostInteraction(postId, 'bookmarkedByMe')
      if (isNetPulseContextChangedError(error)) {
        handleContextMismatch(error)
      } else {
        onNotice(error instanceof Error ? `PULSE // ${error.message}` : 'PULSE // BOOKMARK FAILED')
      }
    } finally {
      endEngagement(pendingKey)
    }
  }
  const toggleFollow = async (accountId: string) => {
    if (!requirePulseAccount()) return
    const expectedAccountId = currentAccountId
    if (!expectedAccountId) return
    if (accountId === currentPulseAccount?.id) {
      onNotice('PULSE // YOU CANNOT FOLLOW YOUR OWN ACCOUNT')
      return
    }
    const pendingKey = `follow:${accountId}`
    if (!beginEngagement(pendingKey)) return
    const isCurrentlyFollowing = followedIds.has(accountId)
    const desiredFollowing = !isCurrentlyFollowing
    setFollowOverride(accountId, desiredFollowing)
    const account = accountsById.get(accountId)
    try {
      await setNetPulseFollow(accountId, desiredFollowing, expectedAccountId)
      onNotice(desiredFollowing
        ? `FOLLOWING // ${account ? `@${account.handle}` : 'PULSE'}`
        : `UNFOLLOWED // ${account ? `@${account.handle}` : 'PULSE'}`)
    } catch (error) {
      setFollowOverride(accountId, undefined)
      if (isNetPulseContextChangedError(error)) {
        handleContextMismatch(error)
      } else {
        onNotice(error instanceof Error ? `PULSE // ${error.message}` : 'PULSE // FOLLOW UPDATE FAILED')
      }
    } finally {
      endEngagement(pendingKey)
    }
  }
  const handleSubmitPost = async () => {
    if (!requirePublishingIdentity() || !publishingPulseAccount || !publishingPulseAuthor) return
    if (pulseContent.submitting) {
      onNotice('PULSE // TRANSMISSION ALREADY IN PROGRESS')
      return
    }
    const trimmed = draft.trim()
    if (!trimmed) {
      onNotice('PULSE // CANNOT SEND AN EMPTY PULSE')
      return
    }

    const expectedAccountId = publishingPulseAccount.id
    try {
      if (isCompromisedAuthoring) {
        await pulseContent.createCompromised({ author: publishingPulseAuthor, body: trimmed })
      } else {
        await pulseContent.create({ author: publishingPulseAuthor, body: trimmed })
      }
      if (publishingAccountIdRef.current !== expectedAccountId) return
      setDraft('')
      onNotice('PULSE // SENT TO THE CITY FEED')
    } catch (error) {
      if (publishingAccountIdRef.current !== expectedAccountId) return
      onNotice(error instanceof Error
        ? `PULSE // ${error.message}`
        : 'PULSE // TRANSMISSION FAILED')
    }
  }
  const handleSubmitReply = async () => {
    if (!requirePublishingIdentity() || !publishingPulseAccount || !publishingPulseAuthor || !selectedPostId) return
    if (pulseContent.submitting) {
      onNotice('PULSE // TRANSMISSION ALREADY IN PROGRESS')
      return
    }
    const trimmed = replyDraft.trim()
    if (!trimmed) {
      onNotice('PULSE // REPLY CANNOT BE EMPTY')
      return
    }
    const parentId = selectedPostId
    const parentPost = postsById.get(parentId)
    const expectedAccountId = publishingPulseAccount.id

    if (!parentPost?.serverPostId) {
      onNotice('PULSE // REPLIES REQUIRE A SERVER-BACKED PULSE')
      return
    }

    try {
      if (isCompromisedAuthoring) {
        await pulseContent.createCompromised({
          author: publishingPulseAuthor,
          body: trimmed,
          parentPostId: parentPost.serverPostId,
        })
      } else {
        await pulseContent.create({
          author: publishingPulseAuthor,
          body: trimmed,
          parentPostId: parentPost.serverPostId,
        })
      }
      if (publishingAccountIdRef.current !== expectedAccountId) return
      setReplyDraft('')
      onNotice('PULSE // REPLY SENT')
    } catch (error) {
      if (publishingAccountIdRef.current !== expectedAccountId) return
      onNotice(error instanceof Error
        ? `PULSE // ${error.message}`
        : 'PULSE // REPLY FAILED')
    }
  }
  const requestDelete = (post: PulsePostData, mode: PulseDeleteMode) => {
    if (getDeleteMode(post) !== mode) return
    setDeleteClock(Date.now())
    setDeleteError(null)
    setDeleteTarget({ post, mode })
  }
  const handleDelete = async () => {
    if (!deleteTarget?.post.serverPostId || pulseContent.deleting) return
    if (getDeleteMode(deleteTarget.post) !== deleteTarget.mode) {
      setDeleteError(deleteTarget.mode === 'compromised'
        ? 'The current compromised session no longer authorises this deletion.'
        : 'The server deletion window has closed.')
      return
    }
    try {
      if (deleteTarget.mode === 'compromised') {
        await pulseContent.removeCompromised(deleteTarget.post.serverPostId)
      } else {
        await pulseContent.remove(deleteTarget.post.serverPostId)
      }
      setDeleteTarget(null)
      setDeleteError(null)
      onNotice(deleteTarget.post.replyToPostId ? 'PULSE // REPLY DELETED' : 'PULSE // DELETED FROM PUBLIC GRID')
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'PULSE could not be deleted.')
    }
  }
  const openNotification = (notification: NetPulseNotification) => {
    void pulseNotifications.markRead(notification.id).catch((error) => {
      if (!isNetPulseContextChangedError(error)) {
        onNotice(error instanceof Error ? `PULSE // ${error.message}` : 'PULSE // READ STATE FAILED')
      }
    })
    if (notification.type === 'follow') {
      openProfile(notification.actorAccountId)
      return
    }
    if (!notification.postAvailable || !notification.rootPostId) {
      onNotice('PULSE // REFERENCED PULSE IS UNAVAILABLE')
      return
    }
    openThread(getPulseServerRuntimeId(notification.rootPostId))
  }
  const markAllNotificationsRead = async () => {
    if (notificationActionPending) return
    setNotificationActionPending(true)
    try {
      await pulseNotifications.markAllRead()
      onNotice('PULSE // ALL PRIVATE SIGNALS MARKED READ')
    } catch (error) {
      if (!isNetPulseContextChangedError(error)) {
        onNotice(error instanceof Error ? `PULSE // ${error.message}` : 'PULSE // READ STATE FAILED')
      }
    } finally {
      setNotificationActionPending(false)
    }
  }
  const handleSaveProfile = async (input: Parameters<typeof pulseProfile.save>[0]) => {
    await pulseProfile.save(input)
    setFeedTab(input.defaultFeed)
    setProfileEditing(false)
    onNotice('PULSE // PUBLIC PROFILE UPDATED')
  }
  const handleActivate = async (input: { readonly handle: string; readonly profile: PulseProfileDraft }): Promise<string> => {
    let accountId: string
    try {
      accountId = await onActivateAccount(input)
    } catch (error) {
      if (isNetPulseContextChangedError(error)) handleContextMismatch(error)
      throw error
    }
    setLocalState(createPulseLocalState(accountId))
    setFeedTab(input.profile.feedPreference)
    setOnboardingOpen(false)
    setNav('home')
    onNotice('PULSE // PUBLIC IDENTITY ACTIVE')
    return accountId
  }

  const matchesSearch = (post: PulsePostData, query: string) => {
    const q = query.trim().toLowerCase().replace(/^#/, '')
    if (!q) return true
    return post.content.toLowerCase().includes(q)
  }
  const baseList: PulsePostData[] = (() => {
    switch (nav) {
      case 'discover': return orderServerPostsNewestFirst(homePosts)
      case 'bookmarks': return orderServerPostsNewestFirst(posts.filter((post) => post.bookmarkedByMe))
      case 'home':
      default:
        if (feedTab === 'following') {
          return orderFollowingPosts(homePosts.filter(
            (post) => post.viewerFollowsAuthor || Boolean(
              post.followedBoosterAccountId
              && activeLocalState.followOverrides[post.followedBoosterAccountId] !== false,
            ),
          ))
        }
        return orderServerPostsNewestFirst(homePosts)
    }
  })()
  const visiblePosts = searchPending
    ? []
    : trimmedQuery
    ? orderServerPostsNewestFirst(posts.filter((post) => !post.replyToPostId && matchesSearch(post, trimmedQuery)))
    : baseList
  const emptyState = trimmedQuery
    ? {
        title: 'NO PULSES MATCH THIS SEARCH',
        detail: 'No server-backed public Pulse contains this signal.',
        action: { label: 'CLEAR SEARCH', onClick: () => setSearchQuery('') },
      }
    : nav === 'bookmarks'
      ? { title: 'NO SAVED PULSES', detail: 'Bookmark a public signal to keep it with this PULSE identity.' }
      : nav === 'home' && feedTab === 'following'
        ? { title: 'NO FOLLOWED SIGNALS YET', detail: 'Follow public accounts to build this feed.' }
        : nav === 'discover'
          ? { title: 'NO PUBLIC SIGNALS AVAILABLE', detail: 'Discovery will surface public server-backed Pulses as the grid becomes active.' }
          : {
              title: 'NO PUBLIC PULSES YET',
              detail: 'The grid is quiet.',
              ...(currentIdentity.status === 'needs-onboarding'
                ? { action: { label: 'CREATE PULSE IDENTITY', onClick: requestPersonalIdentity } }
                : canPublish
                  ? { action: { label: 'CREATE PULSE', onClick: handleCreatePulseClick } }
                  : {}),
            }
  const selectedPost = selectedPostId ? postsById.get(selectedPostId) : null
  const viewingProfile = viewingProfileId ? accountsById.get(viewingProfileId) : null
  const relationshipProfile = relationshipView
    ? accountsById.get(relationshipView.profileAccountId) ?? relationshipView.profile
    : null
  const resolvedViewingProfile = viewingProfile && viewedPulseProfile.state.status === 'ready'
    && viewedPulseProfile.state.profile.accountId === viewingProfile.id
    ? {
        ...viewingProfile,
        handle: viewedPulseProfile.state.profile.handle,
        bio: viewedPulseProfile.state.profile.bio,
        visibility: viewedPulseProfile.state.profile.visibility,
        discoverable: viewedPulseProfile.state.profile.discoverable,
      }
    : viewingProfile

  let centerContent: ReactNode
  if (onboardingOpen && currentIdentity.status === 'needs-onboarding') {
    centerContent = <PulseOnboarding
      identity={currentIdentity.identity}
      accounts={accounts}
      onActivate={handleActivate}
      onCancel={() => {
        setOnboardingOpen(false)
        setNav('home')
        setSelectedPostId(null)
        setViewingProfileId(null)
        setRelationshipView(null)
        navigationHistoryRef.current = []
      }}
    />
  } else if (profileEditing && publishingPulseAccount && profileSession) {
    centerContent = <PulseProfileEditor
      profile={profileSession}
      saving={pulseProfile.saving}
      compromised={isCompromisedAuthoring}
      onSave={handleSaveProfile}
      onCancel={() => setProfileEditing(false)}
    />
  } else if (nav === 'notifications' && notificationViewerAccountId) {
    centerContent = <PulseNotificationsPanel
      notifications={pulseNotifications.state.notifications}
      unreadCount={pulseNotifications.state.unreadCount}
      status={pulseNotifications.state.status}
      refreshing={pulseNotifications.state.refreshing}
      loadingMore={pulseNotifications.state.loadingMore}
      hasMore={pulseNotifications.state.hasMore}
      {...(pulseNotifications.state.reason ? { reason: pulseNotifications.state.reason } : {})}
      markingAll={notificationActionPending}
      onOpen={openNotification}
      onMarkAllRead={() => { void markAllNotificationsRead() }}
      onRetry={pulseNotifications.retry}
      onLoadMore={() => { void pulseNotifications.loadMore() }}
    />
  } else if (relationshipView && relationshipProfile) {
    centerContent = <PulseRelationshipPanel
      profile={relationshipProfile}
      direction={relationshipView.direction}
      results={relationshipAccounts.results}
      loading={relationshipAccounts.status === 'loading' || relationshipAccounts.status === 'refreshing'}
      hasMore={relationshipAccounts.hasMore}
      loadingMore={relationshipAccounts.loadingMore}
      {...(relationshipAccounts.status === 'error' ? { error: relationshipAccounts.reason } : {})}
      currentAccountId={currentPulseAccount?.id ?? null}
      canFollow={canOfferOwnerEngagement}
      pendingAccountIds={pendingFollowIds}
      isFollowing={(account) => activeLocalState.followOverrides[account.accountId] ?? account.viewerFollowing}
      onBack={navigateBack}
      onRetry={() => setRelationshipRetryRevision((revision) => revision + 1)}
      onLoadMore={() => { void relationshipAccounts.loadMore() }}
      onOpenProfile={openProfile}
      onToggleFollow={(accountId) => { void toggleFollow(accountId) }}
    />
  } else if (relationshipView) {
    centerContent = <div className="pulse-relationships">
      <button type="button" className="pulse-back" onClick={navigateBack}>
        <ArrowLeft size={14} /> Back
      </button>
      <PulseFeedEmptyState
        title="PROFILE UNAVAILABLE"
        detail="This public social graph is no longer available."
      />
    </div>
  } else if (selectedPost) {
    const author = accountsById.get(selectedPost.authorId)
    const quotedPost = selectedPost.quotedPostId ? postsById.get(selectedPost.quotedPostId) : undefined
    const replies = posts
      .filter((post) => post.replyToPostId === selectedPost.id)
      .sort((left, right) => Date.parse(left.serverCreatedAt ?? '') - Date.parse(right.serverCreatedAt ?? ''))
    centerContent = author ? <ThreadView
      post={selectedPost}
      author={author}
      quoted={quotedPost ? { post: quotedPost, author: accountsById.get(quotedPost.authorId) ?? author } : null}
      replies={replies}
      accountsById={accountsById}
      replyDraft={replyDraft}
      canAuthor={canPublish}
      {...(isCompromisedAuthoring && publishingPulseAccount
        ? { compromisedHandle: publishingPulseAccount.handle }
        : {})}
      submitting={pulseContent.submitting}
      hasMoreReplies={pulseContent.state.hasMore}
      loadingMoreReplies={pulseContent.state.loadingMore}
      pageLoadFailed={pulseContent.state.status === 'error'}
      readOnlyEngagement={isCompromisedAuthoring || currentIdentity.status === 'gm-no-persona'}
      onReplyDraftChange={setReplyDraft}
      onSubmitReply={handleSubmitReply}
      onLoadMoreReplies={() => {
        void (pulseContent.state.status === 'error' ? pulseContent.refresh() : pulseContent.loadMore())
      }}
      onRequireAccount={requestPublishingIdentity}
      onBack={navigateBack}
      onOpenThread={openThread}
      onOpenProfile={openProfile}
      onReact={toggleReaction}
      onBoost={toggleBoost}
      onBookmark={toggleBookmark}
      onDistrictClick={setDistrictFilter}
      onTopicClick={setTopicFilter}
      getDeleteMode={getDeleteMode}
      onRequestDelete={requestDelete}
      isInteractionPending={isInteractionPending}
    /> : null
  } else if (selectedPostId) {
    centerContent = <div className="pulse-thread">
      <button type="button" className="pulse-back" onClick={navigateBack}>
        <ArrowLeft size={14} /> Back
      </button>
      <PulseFeedEmptyState
        title={pulseContent.state.status === 'error' ? 'THREAD UNAVAILABLE' : 'SYNCING THREAD'}
        detail={pulseContent.state.status === 'error'
          ? 'The confirmed thread could not be loaded. Retry when the Public Grid responds.'
          : 'Loading a bounded reply window from the Public Grid.'}
        {...(pulseContent.state.status === 'error'
          ? { action: { label: 'RETRY', onClick: () => { void pulseContent.refresh() } } }
          : {})}
      />
    </div>
  } else if (viewingProfile && resolvedViewingProfile) {
    centerContent = <PulseProfilePanel
      account={resolvedViewingProfile}
      posts={posts.filter((post) => post.authorId === viewingProfile.id && !post.replyToPostId)}
      postsById={postsById}
      accountsById={accountsById}
      isSelf={viewingProfile.id === currentPulseAccount?.id}
      isFollowing={followedIds.has(viewingProfile.id)}
      followPending={pendingFollowIds.has(viewingProfile.id)}
      socialGraphAvailable={resolvedViewingProfile.visibility === 'public'
        || viewingProfile.id === currentPulseAccount?.id}
      onToggleFollow={() => { void toggleFollow(viewingProfile.id) }}
      onOpenFollowers={() => openRelationships(viewingProfile.id, 'followers')}
      onOpenFollowing={() => openRelationships(viewingProfile.id, 'following')}
      onBack={navigateBack}
      onOpenThread={openThread}
      onOpenProfile={openProfile}
      onReact={toggleReaction}
      onBoost={toggleBoost}
      onBookmark={toggleBookmark}
      readOnly={!canOfferOwnerEngagement}
      onDistrictClick={setDistrictFilter}
      onTopicClick={setTopicFilter}
      {...(viewingProfile.id === currentPulseAccount?.id && profileSession && pulseProfile.state.status === 'ready'
        ? { onEdit: () => setProfileEditing(true) }
        : {})}
      canDeletePost={(post) => Boolean(getDeleteMode(post))}
      isControlledDelete={(post) => getDeleteMode(post) === 'compromised'}
      onRequestDelete={(post) => {
        const mode = getDeleteMode(post)
        if (mode) requestDelete(post, mode)
      }}
      isInteractionPending={isInteractionPending}
      hasMorePosts={pulseContent.state.hasMore}
      loadingMorePosts={pulseContent.state.loadingMore}
      pageLoadFailed={pulseContent.state.status === 'error'}
      onLoadMorePosts={() => {
        void (pulseContent.state.status === 'error' ? pulseContent.refresh() : pulseContent.loadMore())
      }}
    />
  } else if (nav === 'profile') {
    centerContent = currentPulseAccount ? <PulseProfilePanel
      account={currentPulseAccount}
      posts={posts.filter((post) => post.authorId === currentPulseAccount.id && !post.replyToPostId)}
      postsById={postsById}
      accountsById={accountsById}
      isSelf
      isFollowing={false}
      followPending={false}
      metricsPending={profileAccountSummary.status !== 'ready'}
      onToggleFollow={() => {}}
      onOpenFollowers={() => openRelationships(currentPulseAccount.id, 'followers')}
      onOpenFollowing={() => openRelationships(currentPulseAccount.id, 'following')}
      onBack={navigateBack}
      onOpenThread={openThread}
      onOpenProfile={openProfile}
      onReact={toggleReaction}
      onBoost={toggleBoost}
      onBookmark={toggleBookmark}
      onDistrictClick={setDistrictFilter}
      onTopicClick={setTopicFilter}
      {...(profileSession && pulseProfile.state.status === 'ready'
        ? { onEdit: () => setProfileEditing(true) }
        : {})}
      canDeletePost={(post) => Boolean(getDeleteMode(post))}
      isControlledDelete={(post) => getDeleteMode(post) === 'compromised'}
      onRequestDelete={(post) => {
        const mode = getDeleteMode(post)
        if (mode) requestDelete(post, mode)
      }}
      isInteractionPending={isInteractionPending}
      hasMorePosts={pulseContent.state.hasMore}
      loadingMorePosts={pulseContent.state.loadingMore}
      pageLoadFailed={pulseContent.state.status === 'error'}
      onLoadMorePosts={() => {
        void (pulseContent.state.status === 'error' ? pulseContent.refresh() : pulseContent.loadMore())
      }}
    /> : compromisedPulseAccount ? <PulseProfilePanel
      account={compromisedPulseAccount}
      posts={posts.filter((post) => post.authorId === compromisedPulseAccount.id && !post.replyToPostId)}
      postsById={postsById}
      accountsById={accountsById}
      isSelf
      isFollowing={false}
      followPending={false}
      metricsPending={profileAccountSummary.status !== 'ready'}
      socialGraphAvailable={compromisedPulseAccount.visibility === 'public'}
      onToggleFollow={() => {}}
      onOpenFollowers={() => openRelationships(compromisedPulseAccount.id, 'followers')}
      onOpenFollowing={() => openRelationships(compromisedPulseAccount.id, 'following')}
      onBack={navigateBack}
      onOpenThread={openThread}
      onOpenProfile={openProfile}
      onReact={toggleReaction}
      onBoost={toggleBoost}
      onBookmark={toggleBookmark}
      onDistrictClick={setDistrictFilter}
      onTopicClick={setTopicFilter}
      readOnly
      readOnlyNotice="COMPROMISED SESSION // AUDITED PROFILE CONTROL"
      {...(profileSession && pulseProfile.state.status === 'ready'
        ? { onEdit: () => setProfileEditing(true), controlledEdit: true }
        : {})}
      canDeletePost={(post) => Boolean(getDeleteMode(post))}
      isControlledDelete={(post) => getDeleteMode(post) === 'compromised'}
      onRequestDelete={(post) => {
        const mode = getDeleteMode(post)
        if (mode) requestDelete(post, mode)
      }}
      isInteractionPending={isInteractionPending}
      hasMorePosts={pulseContent.state.hasMore}
      loadingMorePosts={pulseContent.state.loadingMore}
      pageLoadFailed={pulseContent.state.status === 'error'}
      onLoadMorePosts={() => {
        void (pulseContent.state.status === 'error' ? pulseContent.refresh() : pulseContent.loadMore())
      }}
    /> : <PulseAccountGate
      title={currentIdentity.status === 'gm-no-persona' ? 'NO ACTIVE PERSONA' : currentIdentity.status === 'loading' ? 'RESOLVING PULSE IDENTITY' : currentIdentity.status === 'restricted' ? 'PULSE IDENTITY RESTRICTED' : 'CREATE PULSE IDENTITY'}
      detail={currentIdentity.status === 'needs-onboarding' ? 'Choose how this character enters the public grid.' : currentIdentity.status === 'gm-no-persona' ? currentIdentity.message : currentIdentity.status === 'loading' ? currentIdentity.message : currentIdentity.status === 'restricted' ? currentIdentity.message : 'A linked fictional character is required for profile ownership.'}
      {...(currentIdentity.status === 'needs-onboarding' ? { action: requestPersonalIdentity } : {})}
    />
  } else {
    centerContent = <>
      <header className="pulse-center__head">
        <div><h2>{trimmedQuery ? `SEARCH // "${trimmedQuery}"` : NAV_TITLES[nav]}</h2></div>
        <div className="pulse-search"><Search size={14} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} maxLength={MAX_SEARCH_CHARS} placeholder="Search Pulses, accounts, #topics" aria-label="Search PULSE" />{searchQuery ? <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search" title="Clear search"><X size={13} /></button> : null}</div>
      </header>
      {nav === 'home' && !trimmedQuery ? <div className="pulse-tabs" role="tablist">{FEED_TABS.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={feedTab === tab.id} data-active={feedTab === tab.id ? 'true' : 'false'} onClick={() => setFeedTab(tab.id)}>{tab.label}</button>)}</div> : null}
      {trimmedQuery ? <PulseAccountSearchResults
        heading="ACCOUNTS"
        ariaLabel="PULSE account search results"
        results={accountSearch.results}
        loading={accountSearch.status === 'loading'}
        emptyTitle="NO PUBLIC ACCOUNTS FOUND"
        emptyDetail="No discoverable public handle matches this search."
        currentAccountId={currentPulseAccount?.id ?? null}
        canFollow={canOfferOwnerEngagement}
        pendingAccountIds={pendingFollowIds}
        isFollowing={(account) => activeLocalState.followOverrides[account.accountId] ?? account.viewerFollowing}
        onOpenProfile={openProfile}
        onToggleFollow={(accountId) => { void toggleFollow(accountId) }}
      /> : null}
      {nav === 'discover' && !trimmedQuery ? <PulseAccountSearchResults
        heading="PUBLIC ACCOUNTS // NEWEST"
        ariaLabel="Recently created discoverable PULSE accounts"
        results={discoverAccounts.results}
        loading={discoverAccounts.status === 'loading' || discoverAccounts.status === 'refreshing'}
        emptyTitle="NO PUBLIC ACCOUNTS FOUND"
        emptyDetail="The discoverable public-account directory is quiet."
        currentAccountId={currentPulseAccount?.id ?? null}
        canFollow={canOfferOwnerEngagement}
        pendingAccountIds={pendingFollowIds}
        isFollowing={(account) => activeLocalState.followOverrides[account.accountId] ?? account.viewerFollowing}
        onOpenProfile={openProfile}
        onToggleFollow={(accountId) => { void toggleFollow(accountId) }}
      /> : null}
      {trimmedQuery || nav === 'discover' ? (
        <div className="pulse-directory-heading">
          <h3>{trimmedQuery ? 'PULSES' : 'PUBLIC PULSES'}</h3>
          <span>{trimmedQuery ? 'SERVER TEXT MATCHES' : 'RECENT // NEWEST FIRST'}</span>
        </div>
      ) : null}
      {nav === 'home' && !trimmedQuery ? (
        <form
          className="pulse-composer"
          data-compromised={isCompromisedAuthoring ? 'true' : 'false'}
          aria-busy={pulseContent.submitting}
          onSubmit={(event) => { event.preventDefault(); void handleSubmitPost() }}
        >
          {isCompromisedAuthoring && publishingPulseAccount ? (
            <div className="pulse-controlled-context" role="status">
              <ShieldAlert size={13} />
              <span>
                <strong>POSTING THROUGH COMPROMISED SESSION</strong>
                @{publishingPulseAccount.handle} // authenticated GM remains active // audited
              </span>
            </div>
          ) : null}
          <span className="pulse-composer__avatar">
            {publishingPulseAccount?.avatarUrl
              ? <SharedMediaImage source={publishingPulseAccount.avatarUrl} variant="thumbnail" alt="" />
              : publishingPulseAccount
                ? publishingPulseAccount.handle.slice(0, 1).toUpperCase()
                : <Radio size={15} />}
          </span>
          <div className="pulse-composer__body">
            {!isCompromisedAuthoring && publishingPulseAccount ? (
              <span className="pulse-composer__identity">@{publishingPulseAccount.handle}</span>
            ) : null}
            <textarea
              ref={composerRef}
              value={draft}
              maxLength={MAX_CHARS}
              readOnly={!canPublish || pulseContent.submitting}
              onFocus={() => { if (!canPublish) requestPublishingIdentity() }}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={composerPlaceholder}
              aria-label={isCompromisedAuthoring ? 'Compose an audited compromised Pulse' : 'Compose a Pulse'}
            />
            <div className="pulse-composer__foot">
              <span data-low={MAX_CHARS - draft.length <= 20 ? 'true' : 'false'}>{MAX_CHARS - draft.length}</span>
              <button
                type={canPublish ? 'submit' : 'button'}
                disabled={pulseContent.submitting || (canPublish && !draft.trim())}
                onClick={canPublish ? undefined : requestPublishingIdentity}
              >
                <Send size={13} />
                {pulseContent.submitting ? 'Sending…' : canPublish ? 'Pulse' : composerActionLabel}
              </button>
            </div>
          </div>
        </form>
      ) : null}
      {pulseContent.state.refreshing && visiblePosts.length > 0 ? (
        <p className="pulse-page-sync" role="status">REFRESHING PUBLIC GRID</p>
      ) : null}
      <div className="pulse-timeline">{searchPending ? <PulseFeedEmptyState title="SEARCHING PUBLIC GRID" detail="Preparing a bounded server search." /> : pulseContent.state.status === 'loading' && visiblePosts.length === 0 ? <PulseFeedEmptyState title="SYNCING PUBLIC GRID" detail="Waiting for a bounded page of server-backed signals." /> : pulseContent.state.status === 'error' && visiblePosts.length === 0 ? <PulseFeedEmptyState title="PUBLIC GRID UNAVAILABLE" detail="No confirmed signals are cached for this view." action={{ label: 'RETRY', onClick: () => { void pulseContent.refresh() } }} /> : visiblePosts.length === 0 ? <PulseFeedEmptyState {...emptyState} /> : visiblePosts.map((post) => {
        const author = accountsById.get(post.authorId)
        if (!author) return null
        const quotedPost = post.quotedPostId ? postsById.get(post.quotedPostId) : undefined
        const deleteMode = getDeleteMode(post)
        return <PulsePost key={post.id} post={post} author={author} quoted={quotedPost ? { post: quotedPost, author: accountsById.get(quotedPost.authorId) ?? author } : null} onOpenThread={openThread} onOpenProfile={openProfile} onReact={toggleReaction} onBoost={toggleBoost} onBookmark={toggleBookmark} readOnlyActions={isCompromisedAuthoring || currentIdentity.status === 'gm-no-persona'} {...(nav === 'home' && feedTab === 'following' && post.followedBoosterHandle ? { boostContextHandle: post.followedBoosterHandle } : {})} reactionPending={isInteractionPending(post.id, 'reaction')} boostPending={isInteractionPending(post.id, 'boost')} bookmarkPending={isInteractionPending(post.id, 'bookmark')} onDistrictClick={setDistrictFilter} onTopicClick={setTopicFilter} {...(deleteMode ? { onDelete: () => requestDelete(post, deleteMode), deleteLabel: 'Delete Pulse' as const, controlledDelete: deleteMode === 'compromised' } : {})} />
      })}</div>
      <PulseLoadMore
        available={!searchPending && pulseContent.state.hasMore}
        pending={pulseContent.state.loadingMore}
        failed={pulseContent.state.status === 'error' && visiblePosts.length > 0}
        label="Load more Pulses"
        onLoad={() => {
          void (pulseContent.state.status === 'error' ? pulseContent.refresh() : pulseContent.loadMore())
        }}
      />
    </>
  }

  const selfLabel = publishingPulseAccount
    ? `@${publishingPulseAccount.handle}`
    : compromisedSession.status === 'unavailable'
      ? 'COMPROMISED // PULSE TARGET'
    : currentIdentity.status === 'needs-onboarding'
      ? 'CREATE PULSE IDENTITY'
      : currentIdentity.status === 'gm-no-persona'
        ? 'NO ACTIVE PERSONA'
        : currentIdentity.status === 'loading'
          ? 'SYNCHRONIZING IDENTITY'
          : 'IDENTITY REQUIRED'
  const selfHandle = isCompromisedAuthoring && publishingPulseAccount
    ? 'COMPROMISED SESSION // AUDITED POSTS ONLY'
    : compromisedSession.status === 'unavailable'
      ? compromisedSession.code === 'no-account' ? 'NO PULSE ACCOUNT' : 'TARGET UNAVAILABLE'
    : currentPulseAccount
    ? 'PULSE PUBLIC IDENTITY'
    : currentIdentity.status === 'needs-onboarding' ? 'PUBLIC PROFILE AVAILABLE' : 'BROWSE ONLY'

  return <div className="pulse-app">
    <nav className="pulse-nav" aria-label="PULSE navigation">
      <div className="pulse-nav__brand"><strong>PULSE</strong><span>OWNED BY VOX NET</span></div>
      <div className="pulse-nav__items">{NAV_ITEMS.filter((item) => item.id !== 'notifications' || Boolean(notificationViewerAccountId)).map((item) => {
        const Icon = item.icon
        const isActive = nav === item.id && !selectedPostId && !viewingProfileId
        const unreadCount = item.id === 'notifications' ? pulseNotifications.state.unreadCount : null
        return <button key={item.id} type="button" data-active={isActive ? 'true' : 'false'} onClick={() => handleNavClick(item.id)}><Icon size={16} /><span>{item.label}</span>{unreadCount !== null && unreadCount > 0 ? <b className="pulse-nav__badge" aria-label={`${unreadCount} unread notifications`}>{unreadCount > 99 ? '99+' : unreadCount}</b> : null}</button>
      })}</div>
      <button type="button" className="pulse-nav__compose" onClick={handleCreatePulseClick}><SquarePen size={15} />Create Pulse</button>
      <button type="button" className="pulse-nav__self" data-compromised={isCompromisedAuthoring ? 'true' : 'false'} onClick={() => currentPulseAccount ? openProfile(currentPulseAccount.id) : compromisedPulseAccount ? openProfile(compromisedPulseAccount.id) : handleNavClick('profile')}>
        <span className="pulse-nav__self-avatar">{publishingPulseAccount?.avatarUrl ? <SharedMediaImage source={publishingPulseAccount.avatarUrl} variant="thumbnail" alt="" /> : publishingPulseAccount ? publishingPulseAccount.handle.slice(0, 1).toUpperCase() : <User size={15} />}</span>
        <span className="pulse-nav__self-copy"><strong>{selfLabel}</strong><small>{selfHandle}</small></span>
      </button>
      <p className="pulse-nav__footnote">Authenticated through {networkAuthorityLabel}</p>
    </nav>
    <section className="pulse-center">{centerContent}</section>
    {deleteTarget ? <PulseDeleteConfirmation
      kind={deleteTarget.post.replyToPostId ? 'reply' : 'post'}
      pending={pulseContent.deleting}
      expired={deleteTarget.mode === 'owner' && getDeleteMode(deleteTarget.post) !== 'owner'}
      compromised={deleteTarget.mode === 'compromised'}
      error={deleteError}
      onConfirm={() => { void handleDelete() }}
      onCancel={() => {
        if (pulseContent.deleting) return
        setDeleteTarget(null)
        setDeleteError(null)
      }}
    /> : null}
  </div>
}
