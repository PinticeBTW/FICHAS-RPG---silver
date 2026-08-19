import {
  ArrowLeft,
  AtSign,
  Bell,
  Bookmark,
  Check,
  Heart,
  Home,
  Image as ImageIcon,
  Link as LinkIcon,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  Send,
  Trash2,
  UserCog,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

import { removeSharedMediaReference } from '../../../lib/media/mediaStorage'
import {
  createNetAltaraWaveAccount,
  createNetAltaraWavePost,
  deleteNetAltaraWavePost,
  fetchNetAltaraWaveAccounts,
  fetchNetAltaraWaveNotifications,
  fetchNetAltaraWavePage,
  fetchNetAltaraWaveRelationships,
  fetchNetAltaraWaveThread,
  markNetAltaraWaveNotificationRead,
  setNetAltaraWaveBookmark,
  setNetAltaraWaveBoost,
  setNetAltaraWaveFollow,
  setNetAltaraWaveReaction,
  updateNetAltaraWaveProfile,
} from '../../../lib/netAltaraWaveService'
import {
  NET_ALTARA_WAVE_BIO_MAX_LENGTH,
  NET_ALTARA_WAVE_HANDLE_MAX_LENGTH,
  NET_ALTARA_WAVE_POST_MAX_LENGTH,
  type NetAltaraWaveAccount,
  type NetAltaraWaveFeedMode,
  type NetAltaraWaveNotificationPage,
  type NetAltaraWavePost,
  type NetAltaraWavePostPage,
  type NetAltaraWaveProfileInput,
  type NetAltaraWaveRelationshipPage,
  type NetAltaraWaveSession,
  type NetAltaraWaveThreadPage,
} from '../../../lib/netAltaraWaveTypes'
import { SharedMediaImage } from '../../shared/SharedMediaImage'
import { normalizeNetHandle } from '../accounts/netAppAccountSelectors'
import { NetAppProfileEditor } from '../profile/NetAppProfileEditor'
import { useNetAppPresentation } from '../profile/useNetAppIdentityPresentation'
import { useNetAltaraWave } from './useNetAltaraWave'

import '../../../styles/altaraWave.css'

type WavePrimaryView = 'home' | 'explore' | 'notifications' | 'bookmarks' | 'profile'
type WaveScreen =
  | { readonly kind: 'primary'; readonly view: WavePrimaryView }
  | { readonly kind: 'profile'; readonly accountId: string }
  | { readonly kind: 'thread' }
  | { readonly kind: 'relationships'; readonly accountId: string; readonly direction: 'followers' | 'following' }
  | { readonly kind: 'edit-profile' }

interface WaveConversationState {
  readonly conversationRootId: string
  readonly replyTargetId: string
}

interface WaveComposerSubmission {
  readonly body: string
  readonly parentPostId: string | null
}

type WaveComposerMode =
  | { readonly kind: 'root' }
  | {
      readonly kind: 'reply'
      readonly target: NetAltaraWavePost
      readonly canResetTarget: boolean
    }

interface AltaraWaveAppProps {
  readonly enabled: boolean
  readonly identitySessionKey: string
  readonly expectedIdentityLinkId?: string
  readonly onNotice: (message: string) => void
}

type WaveAvatarSize = 'small' | 'medium' | 'large'

interface WaveAppPresentation {
  readonly displayName: string
  readonly avatarUrl?: string
}

function initials(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'W'
}

function relativeTime(value: string): string {
  const difference = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(difference)) return 'now'
  const minutes = Math.max(0, Math.floor(difference / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d` : new Date(value).toLocaleDateString([], { day: '2-digit', month: 'short' })
}

function WaveAvatar({ account, size = 'medium' }: { readonly account: Pick<NetAltaraWaveAccount, 'displayName' | 'avatarRef'>; readonly size?: WaveAvatarSize }) {
  const fallback = <span>{initials(account.displayName)}</span>
  return (
    <span className="altara-wave-avatar" data-size={size}>
      {account.avatarRef
        ? <SharedMediaImage source={account.avatarRef} variant="thumbnail" alt="" fallback={fallback} errorFallback={fallback} />
        : fallback}
    </span>
  )
}

function WaveAppProfileAvatar({
  displayName,
  avatarUrl,
  size = 'medium',
}: WaveAppPresentation & {
  readonly size?: WaveAvatarSize
}) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const visibleAvatarUrl = avatarUrl && avatarUrl !== failedUrl
    ? avatarUrl
    : undefined

  return (
    <span className="altara-wave-avatar" data-size={size} aria-hidden="true">
      {visibleAvatarUrl
        ? <img src={visibleAvatarUrl} alt="" onError={() => setFailedUrl(visibleAvatarUrl)} />
        : <span>{initials(displayName)}</span>}
    </span>
  )
}

function WaveFeedback({ icon, title, copy, action }: { readonly icon?: ReactNode; readonly title: string; readonly copy: string; readonly action?: ReactNode }) {
  return (
    <section className="altara-wave-feedback">
      <span>{icon ?? <AtSign size={22} aria-hidden="true" />}</span>
      <h2>{title}</h2>
      <p>{copy}</p>
      {action}
    </section>
  )
}

function WaveAccountRow({ account, onOpen, onFollow, busy }: {
  readonly account: NetAltaraWaveAccount
  readonly onOpen: () => void
  readonly onFollow?: () => void
  readonly busy?: boolean
}) {
  return (
    <article className="altara-wave-account-row">
      <button type="button" className="altara-wave-account-row__identity" onClick={onOpen}>
        <WaveAvatar account={account} />
        <span><strong>{account.displayName}</strong><small>@{account.handle}</small></span>
      </button>
      {onFollow && !account.viewerOwns ? (
        <button type="button" className="altara-wave-follow" data-following={account.viewerFollowing ? 'true' : 'false'} disabled={busy} onClick={onFollow}>
          {account.viewerFollowing ? <UserMinus size={13} /> : <UserPlus size={13} />}
          {account.viewerFollowing ? 'FOLLOWING' : 'FOLLOW'}
        </button>
      ) : null}
    </article>
  )
}

function WavePostBody({ post, onProfile }: { readonly post: NetAltaraWavePost; readonly onProfile: (accountId: string) => void }) {
  if (post.deleted) return <p className="altara-wave-post__deleted">This post was removed by its author.</p>
  const mentionByHandle = new Map(post.mentions.flatMap((mention) => [
    [mention.sourceHandle.toLowerCase(), mention.accountId] as const,
    [mention.currentHandle.toLowerCase(), mention.accountId] as const,
  ]))
  const parts = post.body.split(/(@[a-z0-9][a-z0-9._-]{1,31})/gi)
  return (
    <>
      {post.body ? <p className="altara-wave-post__body">{parts.map((part, index) => {
        const accountId = part.startsWith('@') ? mentionByHandle.get(part.slice(1).toLowerCase()) : undefined
        return accountId
          ? <button type="button" key={`${part}-${index}`} onClick={() => onProfile(accountId)}>{part}</button>
          : <span key={`${part}-${index}`}>{part}</span>
      })}</p> : null}
      {post.mediaRef ? (
        <SharedMediaImage
          source={post.mediaRef}
          variant="display"
          className="altara-wave-post__media"
          alt={`Media shared by ${post.author.displayName}`}
          fallback={<div className="altara-wave-post__media-fallback"><ImageIcon size={20} /><span>Private image unavailable</span></div>}
        />
      ) : null}
    </>
  )
}

function WavePostCard({ post, viewerAccountId, viewerPresentation, busyAction, onProfile, onThread, onReply, onReaction, onBoost, onBookmark, onDelete }: {
  readonly post: NetAltaraWavePost
  readonly viewerAccountId: string
  readonly viewerPresentation?: WaveAppPresentation
  readonly busyAction?: string
  readonly onProfile: (accountId: string) => void
  readonly onThread: (post: NetAltaraWavePost) => void
  readonly onReply: (post: NetAltaraWavePost) => void
  readonly onReaction: (post: NetAltaraWavePost) => void
  readonly onBoost: (post: NetAltaraWavePost) => void
  readonly onBookmark: (post: NetAltaraWavePost) => void
  readonly onDelete: (post: NetAltaraWavePost) => void
}) {
  const busy = busyAction?.endsWith(post.id)
  const authorPresentation = post.authorAccountId === viewerAccountId
    ? viewerPresentation
    : undefined
  const authorDisplayName = authorPresentation?.displayName ?? post.author.displayName
  return (
    <article className="altara-wave-post" data-deleted={post.deleted ? 'true' : 'false'}>
      {post.boostedBy ? <button type="button" className="altara-wave-post__boost-note" onClick={() => onProfile(post.boostedBy!.id)}><Repeat2 size={12} /> @{post.boostedBy.handle} amplified</button> : null}
      <div className="altara-wave-post__layout">
        <button type="button" className="altara-wave-post__avatar" onClick={() => onProfile(post.author.id)} aria-label={`Open ${authorDisplayName}'s profile`}>
          {authorPresentation
            ? <WaveAppProfileAvatar displayName={authorPresentation.displayName} avatarUrl={authorPresentation.avatarUrl} />
            : <WaveAvatar account={post.author} />}
        </button>
        <div className="altara-wave-post__content">
          <header>
            <button type="button" onClick={() => onProfile(post.author.id)}><strong>{authorDisplayName}</strong><span>@{post.author.handle}</span></button>
            <button type="button" onClick={() => onThread(post)}><time>{relativeTime(post.createdAt)}</time></button>
          </header>
          <div className="altara-wave-post__open">
            <WavePostBody post={post} onProfile={onProfile} />
          </div>
          <footer>
            <button type="button" disabled={busy || post.deleted} onClick={() => onReply(post)} aria-label="Reply"><MessageCircle size={15} /><span>{post.replyCount || ''}</span></button>
            <button type="button" data-active={post.viewerBoosted ? 'true' : 'false'} disabled={busy || post.deleted} onClick={() => onBoost(post)} aria-label={post.viewerBoosted ? 'Remove boost' : 'Boost'}><Repeat2 size={15} /><span>{post.boostCount || ''}</span></button>
            <button type="button" data-active={post.viewerReacted ? 'true' : 'false'} disabled={busy || post.deleted} onClick={() => onReaction(post)} aria-label={post.viewerReacted ? 'Unlike' : 'Like'}><Heart size={15} fill={post.viewerReacted ? 'currentColor' : 'none'} /><span>{post.reactionCount || ''}</span></button>
            <button type="button" data-active={post.viewerBookmarked ? 'true' : 'false'} disabled={busy || post.deleted} onClick={() => onBookmark(post)} aria-label={post.viewerBookmarked ? 'Remove bookmark' : 'Bookmark'}><Bookmark size={15} fill={post.viewerBookmarked ? 'currentColor' : 'none'} /></button>
            {post.authorAccountId === viewerAccountId && !post.deleted ? <button type="button" className="altara-wave-post__delete" disabled={busy} onClick={() => onDelete(post)} aria-label="Delete post"><Trash2 size={14} /></button> : null}
          </footer>
        </div>
      </div>
    </article>
  )
}

function WaveComposer({ account, presentation, mode, busy, onResetReplyTarget, onSubmit }: {
  readonly account: NetAltaraWaveAccount
  readonly presentation?: WaveAppPresentation
  readonly mode: WaveComposerMode
  readonly busy: boolean
  readonly onResetReplyTarget?: () => void
  readonly onSubmit: (input: WaveComposerSubmission) => Promise<void>
}) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !body.trim()) return
    setError(undefined)
    try {
      await onSubmit({
        body,
        parentPostId: mode.kind === 'reply' ? mode.target.id : null,
      })
      setBody('')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'WAVE could not publish this post.')
    }
  }
  return (
    <form className="altara-wave-composer" onSubmit={submit}>
      {mode.kind === 'reply' ? <div className="altara-wave-composer__reply"><span>Replying to <strong>@{mode.target.author.handle}</strong></span>{mode.canResetTarget && onResetReplyTarget ? <button type="button" onClick={onResetReplyTarget} aria-label="Reply to the conversation root instead"><X size={13} /></button> : null}</div> : null}
      {presentation
        ? <WaveAppProfileAvatar displayName={presentation.displayName} avatarUrl={presentation.avatarUrl} />
        : <WaveAvatar account={account} />}
      <div>
        <textarea value={body} maxLength={NET_ALTARA_WAVE_POST_MAX_LENGTH} rows={mode.kind === 'reply' ? 3 : 4} placeholder={mode.kind === 'reply' ? 'Join the conversation…' : 'Share something with the ALTARA network…'} onChange={(event) => setBody(event.target.value)} />
        <footer>
          <span>{body.length} / {NET_ALTARA_WAVE_POST_MAX_LENGTH}</span>
          <button type="submit" className="altara-wave-composer__submit" disabled={busy || !body.trim()}>{busy ? <LoaderCircle className="altara-wave-spin" size={15} /> : <Send size={14} />}{busy ? 'POSTING' : mode.kind === 'reply' ? 'REPLY' : 'POST'}</button>
        </footer>
        {error ? <p className="altara-wave-inline-error" role="alert">{error}</p> : null}
      </div>
    </form>
  )
}

function WaveProfileEditor({ session, busy, onCancel, onSave }: {
  readonly session: NetAltaraWaveSession
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSave: (input: NetAltaraWaveProfileInput) => Promise<void>
}) {
  const account = session.account!
  const [draft, setDraft] = useState<NetAltaraWaveProfileInput>({
    handle: account.handle,
    displayName: account.displayName,
    bio: account.bio,
    avatarRef: account.avatarOverrideRef,
    bannerRef: account.bannerRef,
    location: account.location,
    websiteUrl: account.websiteUrl,
  })
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(undefined)
    try { await onSave(draft) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'WAVE profile could not be saved.') }
  }
  return (
    <form className="altara-wave-profile-editor" onSubmit={submit}>
      <header><button type="button" onClick={onCancel}><ArrowLeft size={14} /> PROFILE</button><div><h2>Edit profile</h2><p>Your WAVE presentation is separate from OS authority.</p></div><button type="submit" disabled={busy}><Check size={14} /> {busy ? 'SAVING…' : 'SAVE'}</button></header>
      <fieldset>
        <label>DISPLAY NAME<input value={draft.displayName} maxLength={120} required onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
        <label>HANDLE<span className="altara-wave-handle-input"><b>@</b><input value={draft.handle} maxLength={NET_ALTARA_WAVE_HANDLE_MAX_LENGTH} required onChange={(event) => setDraft((current) => ({ ...current, handle: event.target.value.replace(/^@+/, '') }))} /></span></label>
        <label>BIO<textarea value={draft.bio} maxLength={NET_ALTARA_WAVE_BIO_MAX_LENGTH} rows={5} onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))} /><small>{draft.bio.length} / {NET_ALTARA_WAVE_BIO_MAX_LENGTH}</small></label>
        <div><label>LOCATION<input value={draft.location ?? ''} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))} /></label><label>WEBSITE<input type="url" placeholder="https://" value={draft.websiteUrl ?? ''} maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, websiteUrl: event.target.value }))} /></label></div>
      </fieldset>
      {error ? <p className="altara-wave-inline-error" role="alert">{error}</p> : null}
    </form>
  )
}

function WaveOnboarding({
  session,
  presentation,
  busy,
  showAppProfile,
  onToggleAppProfile,
  appProfileEditor,
  onCreate,
}: {
  readonly session: NetAltaraWaveSession
  readonly presentation: WaveAppPresentation
  readonly busy: boolean
  readonly showAppProfile: boolean
  readonly onToggleAppProfile: () => void
  readonly appProfileEditor?: ReactNode
  readonly onCreate: (handle: string) => Promise<void>
}) {
  const suggested = normalizeNetHandle(session.canonicalDisplayName.replace(/\s+/g, '.')) ?? ''
  const [handle, setHandle] = useState(suggested)
  const [error, setError] = useState<string>()
  return (
    <section className="altara-wave-onboarding">
      <div className="altara-wave-onboarding__intro">
        <div className="altara-wave-onboarding__brand">
          <span className="altara-wave-onboarding__mark"><AtSign size={26} /></span>
          <span><strong>WAVE</strong><small>ALTARA SOCIAL NETWORK</small></span>
        </div>
        <h1>Join WAVE</h1>
        <p>Create your identity on the ALTARA social network.</p>
      </div>
      <div className="altara-wave-onboarding__setup">
        <div className="altara-wave-onboarding__identity">
          <WaveAppProfileAvatar displayName={presentation.displayName} avatarUrl={presentation.avatarUrl} />
          <span>
            <small>CONTINUE AS</small>
            <strong>{presentation.displayName}</strong>
          </span>
          <button
            type="button"
            aria-label={showAppProfile ? 'Close WAVE app profile' : 'Edit WAVE app profile'}
            aria-expanded={showAppProfile}
            onClick={onToggleAppProfile}
          >
            <UserCog size={14} aria-hidden="true" />
          </button>
        </div>
        {appProfileEditor}
        <form onSubmit={(event) => { event.preventDefault(); setError(undefined); void onCreate(handle).catch((createError) => setError(createError instanceof Error ? createError.message : 'WAVE activation failed.')) }}>
          <label>WAVE HANDLE<span className="altara-wave-handle-input"><b>@</b><input autoFocus value={handle} maxLength={NET_ALTARA_WAVE_HANDLE_MAX_LENGTH} onChange={(event) => setHandle(event.target.value.replace(/^@+/, ''))} /></span></label>
          <small>This handle is unique to the exact ALTARA identity shown above.</small>
          <button type="submit" disabled={busy || !normalizeNetHandle(handle)}>{busy ? <LoaderCircle className="altara-wave-spin" size={15} /> : <AtSign size={15} />} {busy ? 'ACTIVATING…' : 'JOIN WAVE'}</button>
          {error ? <p role="alert">{error}</p> : null}
        </form>
      </div>
    </section>
  )
}

export function AltaraWaveApp({ enabled, identitySessionKey, expectedIdentityLinkId, onNotice }: AltaraWaveAppProps) {
  const wave = useNetAltaraWave(enabled, identitySessionKey, expectedIdentityLinkId)
  const [screen, setScreen] = useState<WaveScreen>({ kind: 'primary', view: 'home' })
  const [page, setPage] = useState<NetAltaraWavePostPage>()
  const [directory, setDirectory] = useState<NetAltaraWaveRelationshipPage>()
  const [notifications, setNotifications] = useState<NetAltaraWaveNotificationPage>()
  const [thread, setThread] = useState<NetAltaraWaveThreadPage>()
  const [relationships, setRelationships] = useState<NetAltaraWaveRelationshipPage>()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyAction, setBusyAction] = useState<string>()
  const [error, setError] = useState<string>()
  const [conversation, setConversation] = useState<WaveConversationState>()
  const [searchDraft, setSearchDraft] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [localRevision, setLocalRevision] = useState(0)
  const [showAppProfile, setShowAppProfile] = useState(false)
  const loadGenerationRef = useRef(0)
  const screenKeyRef = useRef('')

  const session = wave.state.status === 'ready' ? wave.state.session : undefined
  const account = session?.account ?? undefined
  const conversationRootId = conversation?.conversationRootId
  const viewKey = screen.kind === 'thread'
    ? `thread:${conversationRootId ?? 'lost'}`
    : JSON.stringify(screen)
  screenKeyRef.current = viewKey
  const revision = wave.revision + localRevision
  const appPresentation = useNetAppPresentation({
    appId: 'altara-wave',
    identityLinkId: expectedIdentityLinkId,
    enabled: enabled && Boolean(expectedIdentityLinkId),
    fallbackDisplayName: session?.canonicalDisplayName ?? account?.displayName,
  })
  const selfPresentation: WaveAppPresentation = {
    displayName: appPresentation.displayName,
    ...(appPresentation.avatarUrl ? { avatarUrl: appPresentation.avatarUrl } : {}),
  }
  const appProfileEditor = showAppProfile && expectedIdentityLinkId ? (
    <div className="altara-wave-app-profile">
      <NetAppProfileEditor
        appId="altara-wave"
        appLabel="WAVE"
        identityLinkId={expectedIdentityLinkId}
        onClose={() => setShowAppProfile(false)}
        onSaved={() => { void appPresentation.reload() }}
      />
    </div>
  ) : null

  useEffect(() => {
    setScreen({ kind: 'primary', view: 'home' })
    setPage(undefined); setDirectory(undefined); setNotifications(undefined); setThread(undefined); setRelationships(undefined); setConversation(undefined); setError(undefined)
    setShowAppProfile(false)
  }, [identitySessionKey, expectedIdentityLinkId])

  const refreshVisible = useCallback(() => setLocalRevision((value) => value + 1), [])

  useEffect(() => {
    if (!enabled || !expectedIdentityLinkId || !account) return undefined
    loadGenerationRef.current += 1
    const generation = loadGenerationRef.current
    let cancelled = false
    setLoading(true); setError(undefined)
    const stillCurrent = () => !cancelled && loadGenerationRef.current === generation
    const common = { expectedIdentityLinkId, expectedAccountId: account.id }
    let request: Promise<void>
    if (screen.kind === 'thread') {
      if (!conversationRootId) {
        setError('WAVE // REPLY TARGET LOST')
        setLoading(false)
        return undefined
      }
      request = fetchNetAltaraWaveThread({ ...common, rootPostId: conversationRootId }).then((value) => { if (stillCurrent()) setThread(value) })
    } else if (screen.kind === 'relationships') {
      request = fetchNetAltaraWaveRelationships({ ...common, profileAccountId: screen.accountId, direction: screen.direction }).then((value) => { if (stillCurrent()) setRelationships(value) })
    } else if (screen.kind === 'profile') {
      request = Promise.all([
        fetchNetAltaraWaveAccounts({ ...common, accountId: screen.accountId, limit: 1 }),
        fetchNetAltaraWavePage({ ...common, mode: 'profile', profileAccountId: screen.accountId }),
      ]).then(([accounts, posts]) => { if (stillCurrent()) { setDirectory(accounts); setPage(posts) } })
    } else if (screen.kind === 'edit-profile') {
      request = Promise.resolve()
    } else if (screen.view === 'notifications') {
      request = fetchNetAltaraWaveNotifications(common).then((value) => { if (stillCurrent()) setNotifications(value) })
    } else if (screen.view === 'explore') {
      request = Promise.all([
        fetchNetAltaraWaveAccounts({ ...common, query: searchQuery || undefined }),
        fetchNetAltaraWavePage({ ...common, mode: searchQuery ? 'search' : 'explore', query: searchQuery || undefined }),
      ]).then(([accounts, posts]) => { if (stillCurrent()) { setDirectory(accounts); setPage(posts) } })
    } else {
      const mode: NetAltaraWaveFeedMode = screen.view === 'bookmarks' ? 'bookmarks' : screen.view === 'profile' ? 'profile' : 'home'
      request = fetchNetAltaraWavePage({ ...common, mode, ...(mode === 'profile' ? { profileAccountId: account.id } : {}) }).then((value) => { if (stillCurrent()) setPage(value) })
    }
    void request.catch((loadError: unknown) => { if (stillCurrent()) setError(loadError instanceof Error ? loadError.message : 'WAVE could not load this view.') }).finally(() => { if (stillCurrent()) setLoading(false) })
    return () => { cancelled = true }
  }, [account, conversationRootId, enabled, expectedIdentityLinkId, revision, screen, searchQuery, viewKey])

  if (!enabled || !expectedIdentityLinkId) return <section className="altara-wave"><WaveFeedback title="WAVE NEEDS A RUNTIME IDENTITY" copy="Open WAVE from an installed ALTARA identity. GM System has no fictional social profile." /></section>
  if (wave.state.status === 'loading' || wave.state.status === 'idle') return <section className="altara-wave"><WaveFeedback icon={<LoaderCircle className="altara-wave-spin" />} title="CONNECTING TO WAVE" copy="Resolving the exact ALTARA runtime identity." /></section>
  if (wave.state.status === 'error') return <section className="altara-wave"><WaveFeedback title="WAVE IDENTITY UNAVAILABLE" copy={wave.state.reason} action={<button type="button" onClick={wave.refresh}><RefreshCw size={14} /> RETRY</button>} /></section>
  if (!account) return <section className="altara-wave"><WaveOnboarding session={session!} presentation={selfPresentation} busy={busy} showAppProfile={showAppProfile} onToggleAppProfile={() => setShowAppProfile((current) => !current)} appProfileEditor={appProfileEditor} onCreate={async (handle) => { setBusy(true); try { await createNetAltaraWaveAccount(expectedIdentityLinkId, handle); wave.refresh(); onNotice('WAVE // PROFILE ACTIVATED') } finally { setBusy(false) } }} /></section>

  const common = { expectedIdentityLinkId, expectedAccountId: account.id }
  const runAction = async (key: string, operation: () => Promise<unknown>, notice?: string) => {
    if (busyAction) return
    setBusyAction(key); setError(undefined)
    try { await operation(); if (notice) onNotice(notice); refreshVisible() } catch (actionError) { setError(actionError instanceof Error ? actionError.message : 'WAVE could not complete this action.') } finally { setBusyAction(undefined) }
  }
  const loadMore = async () => {
    if (busyAction || loading) return
    const expectedScreenKey = viewKey
    setBusyAction('load-more')
    try {
      if (screen.kind === 'thread' && thread?.nextCursor) {
        if (!conversationRootId) throw new Error('WAVE // REPLY TARGET LOST')
        const next = await fetchNetAltaraWaveThread({ ...common, rootPostId: conversationRootId, cursor: thread.nextCursor })
        if (screenKeyRef.current === expectedScreenKey) setThread({ ...next, replies: [...thread.replies, ...next.replies] })
      } else if (screen.kind === 'relationships' && relationships?.nextCursor) {
        const next = await fetchNetAltaraWaveRelationships({ ...common, profileAccountId: screen.accountId, direction: screen.direction, cursor: relationships.nextCursor })
        if (screenKeyRef.current === expectedScreenKey) setRelationships({ ...next, accounts: [...relationships.accounts, ...next.accounts] })
      } else if (screen.kind === 'primary' && screen.view === 'notifications' && notifications?.nextCursor) {
        const next = await fetchNetAltaraWaveNotifications({ ...common, cursor: notifications.nextCursor })
        if (screenKeyRef.current === expectedScreenKey) setNotifications({ ...next, notifications: [...notifications.notifications, ...next.notifications] })
      } else if (page?.nextCursor) {
        const mode: NetAltaraWaveFeedMode = screen.kind === 'profile' || (screen.kind === 'primary' && screen.view === 'profile')
          ? 'profile'
          : screen.kind === 'primary' && screen.view === 'bookmarks'
            ? 'bookmarks'
            : screen.kind === 'primary' && screen.view === 'explore'
              ? searchQuery ? 'search' : 'explore'
              : 'home'
        const profileAccountId = screen.kind === 'profile' ? screen.accountId : mode === 'profile' ? account.id : undefined
        const next = await fetchNetAltaraWavePage({ ...common, mode, profileAccountId, query: mode === 'search' ? searchQuery : undefined, cursor: page.nextCursor })
        if (screenKeyRef.current === expectedScreenKey) setPage({ ...next, posts: [...page.posts, ...next.posts] })
      }
    } catch (loadError) {
      if (screenKeyRef.current === expectedScreenKey) setError(loadError instanceof Error ? loadError.message : 'More WAVE results could not be loaded.')
    } finally { setBusyAction(undefined) }
  }
  const loadMoreButton = (visible: boolean) => visible ? <button type="button" className="altara-wave-load-more" disabled={busyAction === 'load-more'} onClick={() => { void loadMore() }}>{busyAction === 'load-more' ? <LoaderCircle className="altara-wave-spin" size={13} /> : <Plus size={13} />} {busyAction === 'load-more' ? 'LOADING…' : 'LOAD MORE'}</button> : null
  const leaveConversation = () => setConversation(undefined)
  const openProfile = (accountId: string) => { leaveConversation(); setScreen(accountId === account.id ? { kind: 'primary', view: 'profile' } : { kind: 'profile', accountId }) }
  const openConversation = (nextConversationRootId: string, nextReplyTargetId: string) => {
    if (conversation?.conversationRootId !== nextConversationRootId) setThread(undefined)
    setConversation({ conversationRootId: nextConversationRootId, replyTargetId: nextReplyTargetId })
    setScreen({ kind: 'thread' })
  }
  const openThread = (post: NetAltaraWavePost) => openConversation(post.rootPostId ?? post.id, post.id)
  const submitPost = async ({ body, parentPostId }: WaveComposerSubmission) => {
    if (parentPostId === undefined || (parentPostId !== null && !parentPostId.trim())) {
      throw new Error('WAVE // REPLY TARGET LOST')
    }
    const requestKey = crypto.randomUUID()
    await createNetAltaraWavePost({ ...common, body, requestKey, parentPostId })
    refreshVisible(); onNotice(parentPostId ? 'WAVE // REPLY PUBLISHED' : 'WAVE // POST PUBLISHED')
  }
  const postActions = {
    viewerAccountId: account.id,
    viewerPresentation: selfPresentation,
    busyAction,
    onProfile: openProfile,
    onThread: openThread,
    onReply: openThread,
    onReaction: (post: NetAltaraWavePost) => { void runAction(`reaction:${post.id}`, () => setNetAltaraWaveReaction(expectedIdentityLinkId, account.id, post.id, !post.viewerReacted)) },
    onBoost: (post: NetAltaraWavePost) => { void runAction(`boost:${post.id}`, () => setNetAltaraWaveBoost(expectedIdentityLinkId, account.id, post.id, !post.viewerBoosted)) },
    onBookmark: (post: NetAltaraWavePost) => { void runAction(`bookmark:${post.id}`, () => setNetAltaraWaveBookmark(expectedIdentityLinkId, account.id, post.id, !post.viewerBookmarked)) },
    onDelete: (post: NetAltaraWavePost) => {
      if (!window.confirm('Delete this WAVE post? Replies remain as part of the conversation.')) return
      void runAction(`delete:${post.id}`, async () => {
        try {
          await deleteNetAltaraWavePost(expectedIdentityLinkId, account.id, post.id)
        } catch (deleteError) {
          // If the response was lost after commit, the server-side delete
          // predicate now recognises this object as detached. If the post is
          // still canonical, cleanup is denied and its media remains intact.
          if (post.mediaRef) await removeSharedMediaReference(post.mediaRef).catch(() => undefined)
          throw deleteError
        }
        let cleanupFailed = false
        if (post.mediaRef) {
          cleanupFailed = await removeSharedMediaReference(post.mediaRef)
            .then(() => false)
            .catch(() => true)
        }
        onNotice(cleanupFailed
          ? 'WAVE // POST REMOVED // MEDIA CLEANUP PENDING'
          : 'WAVE // POST REMOVED')
      })
    },
  }

  const primaryView = screen.kind === 'primary' ? screen.view : undefined
  const navItems: readonly { readonly id: WavePrimaryView; readonly label: string; readonly icon: typeof Home; readonly badge?: number }[] = [
    { id: 'home', label: 'HOME', icon: Home },
    { id: 'explore', label: 'EXPLORE', icon: Search },
    { id: 'notifications', label: 'NOTIFICATIONS', icon: Bell, badge: notifications?.unreadCount ?? session?.unreadCount },
    { id: 'bookmarks', label: 'BOOKMARKS', icon: Bookmark },
    { id: 'profile', label: 'PROFILE', icon: UserRound },
  ]
  const profileAccount = screen.kind === 'profile' ? directory?.accounts[0] : primaryView === 'profile' ? account : undefined
  const conversationReplyTarget = screen.kind === 'thread' && thread && conversation
    ? thread.root.id === conversation.replyTargetId
      ? thread.root
      : thread.replies.find((post) => post.id === conversation.replyTargetId)
    : undefined

  let center: ReactNode
  if (screen.kind === 'edit-profile') {
    center = <WaveProfileEditor session={session!} busy={busy} onCancel={() => setScreen({ kind: 'primary', view: 'profile' })} onSave={async (input) => {
      setBusy(true)
      try {
        await updateNetAltaraWaveProfile(expectedIdentityLinkId, account.id, input)
        wave.refresh(); setScreen({ kind: 'primary', view: 'profile' })
        onNotice('WAVE // PROFILE UPDATED')
      } finally { setBusy(false) }
    }} />
  } else if (screen.kind === 'thread') {
    center = <>
      <header className="altara-wave-view-head">
        <button type="button" onClick={() => { leaveConversation(); setScreen({ kind: 'primary', view: 'home' }) }}><ArrowLeft size={15} /></button>
        <div><h1>Conversation</h1><p>Threaded replies across WAVE</p></div>
      </header>
      {thread && conversation && conversationReplyTarget ? (
        <div className="altara-wave-thread">
          <WavePostCard post={thread.root} {...postActions} />
          <WaveComposer
            key={`reply:${account.id}:${conversation.conversationRootId}`}
            account={account}
            presentation={selfPresentation}
            mode={{
              kind: 'reply',
              target: conversationReplyTarget,
              canResetTarget: conversation.replyTargetId !== conversation.conversationRootId,
            }}
            busy={busyAction === 'compose'}
            onResetReplyTarget={() => setConversation((current) => current ? {
              ...current,
              replyTargetId: current.conversationRootId,
            } : current)}
            onSubmit={async (input) => {
              if (input.parentPostId === null
                || input.parentPostId !== conversation.replyTargetId) {
                throw new Error('WAVE // REPLY TARGET LOST')
              }
              const expectedRootId = conversation.conversationRootId
              setBusyAction('compose')
              try {
                await submitPost(input)
                setConversation((current) => current?.conversationRootId === expectedRootId
                  ? { ...current, replyTargetId: expectedRootId }
                  : current)
              } finally {
                setBusyAction(undefined)
              }
            }}
          />
          <div className="altara-wave-thread__replies">{thread.replies.map((post) => <WavePostCard key={post.id} post={post} {...postActions} />)}</div>
          {loadMoreButton(thread.hasMore)}
        </div>
      ) : thread && conversation ? (
        <WaveFeedback
          title="WAVE // REPLY TARGET LOST"
          copy="Choose the conversation root or select Reply on a visible post before publishing."
          action={<button type="button" onClick={() => setConversation({ ...conversation, replyTargetId: conversation.conversationRootId })}>REPLY TO ROOT</button>}
        />
      ) : null}
    </>
  } else if (screen.kind === 'relationships') {
    center = <><header className="altara-wave-view-head"><button type="button" onClick={() => openProfile(screen.accountId)}><ArrowLeft size={15} /></button><div><h1>{screen.direction === 'followers' ? 'Followers' : 'Following'}</h1><p>Current WAVE-eligible identities</p></div></header><div className="altara-wave-relationship-list">{relationships?.accounts.map((person) => <WaveAccountRow key={person.id} account={person} onOpen={() => openProfile(person.id)} busy={Boolean(busyAction)} onFollow={() => { void runAction(`follow:${person.id}`, () => setNetAltaraWaveFollow(expectedIdentityLinkId, account.id, person.id, !person.viewerFollowing)) }} />)}{loadMoreButton(Boolean(relationships?.hasMore))}</div></>
  } else if (profileAccount) {
    const profileDisplayName = profileAccount.viewerOwns ? selfPresentation.displayName : profileAccount.displayName
    center = <><section className="altara-wave-profile"><div className="altara-wave-profile__banner" aria-hidden="true" /><div className="altara-wave-profile__identity">{profileAccount.viewerOwns ? <WaveAppProfileAvatar displayName={selfPresentation.displayName} avatarUrl={selfPresentation.avatarUrl} size="large" /> : <WaveAvatar account={profileAccount} size="large" />}<div className="altara-wave-profile__actions">{profileAccount.viewerOwns ? <><button type="button" onClick={() => setScreen({ kind: 'edit-profile' })}>EDIT WAVE BIO</button><button type="button" aria-expanded={showAppProfile} onClick={() => setShowAppProfile((current) => !current)}><UserCog size={13} aria-hidden="true" /> APP PROFILE</button></> : <button type="button" className="altara-wave-follow" data-following={profileAccount.viewerFollowing ? 'true' : 'false'} onClick={() => { void runAction(`follow:${profileAccount.id}`, () => setNetAltaraWaveFollow(expectedIdentityLinkId, account.id, profileAccount.id, !profileAccount.viewerFollowing)) }}>{profileAccount.viewerFollowing ? <UserMinus size={13} /> : <UserPlus size={13} />}{profileAccount.viewerFollowing ? 'FOLLOWING' : 'FOLLOW'}</button>}</div></div><h1>{profileDisplayName}</h1><p className="altara-wave-profile__handle">@{profileAccount.handle}</p>{profileAccount.bio ? <p className="altara-wave-profile__bio">{profileAccount.bio}</p> : null}<div className="altara-wave-profile__meta">{profileAccount.location ? <span><MapPin size={13} /> {profileAccount.location}</span> : null}{profileAccount.websiteUrl ? <a href={profileAccount.websiteUrl} target="_blank" rel="noreferrer"><LinkIcon size={13} /> {new URL(profileAccount.websiteUrl).hostname}</a> : null}<span>JOINED {new Date(profileAccount.joinedAt).toLocaleDateString([], { month: 'long', year: 'numeric' }).toUpperCase()}</span></div><div className="altara-wave-profile__counts"><button type="button" onClick={() => setScreen({ kind: 'relationships', accountId: profileAccount.id, direction: 'following' })}><strong>{profileAccount.followingCount}</strong> FOLLOWING</button><button type="button" onClick={() => setScreen({ kind: 'relationships', accountId: profileAccount.id, direction: 'followers' })}><strong>{profileAccount.followersCount}</strong> FOLLOWERS</button><span><strong>{profileAccount.postsCount}</strong> POSTS</span></div></section><div className="altara-wave-stream">{page?.posts.map((post) => <WavePostCard key={post.id} post={post} {...postActions} />)}{loadMoreButton(Boolean(page?.hasMore))}</div></>
  } else if (primaryView === 'notifications') {
    center = <><header className="altara-wave-view-head"><div><h1>Notifications</h1><p>Signals from your WAVE network</p></div>{notifications?.unreadCount ? <button type="button" onClick={() => { void runAction('notifications:all', () => markNetAltaraWaveNotificationRead(expectedIdentityLinkId, account.id), 'WAVE // NOTIFICATIONS READ') }}><Check size={13} /> MARK ALL READ</button> : null}</header><div className="altara-wave-notifications">{notifications?.notifications.map((notification) => <button type="button" key={notification.id} data-unread={!notification.readAt ? 'true' : 'false'} onClick={() => { void markNetAltaraWaveNotificationRead(expectedIdentityLinkId, account.id, notification.id); if (notification.postAvailable && notification.rootPostId) openConversation(notification.rootPostId, notification.postId ?? notification.rootPostId); else openProfile(notification.actor.id) }}><WaveAvatar account={notification.actor} /><span><strong>{notification.actor.displayName}</strong> {notification.type === 'follow' ? 'followed you' : notification.type === 'reaction' ? 'liked your post' : notification.type === 'boost' ? 'amplified your post' : notification.type === 'mention' ? 'mentioned you' : 'replied to you'}{notification.excerpt ? <small>{notification.excerpt}</small> : null}</span><time>{relativeTime(notification.createdAt)}</time></button>)}{!notifications?.notifications.length && !loading ? <WaveFeedback title="ALL QUIET" copy="New follows, replies, mentions, likes, and boosts will appear here." /> : null}{loadMoreButton(Boolean(notifications?.hasMore))}</div></>
  } else if (primaryView === 'explore') {
    center = <><header className="altara-wave-view-head"><div><h1>Explore</h1><p>Find people and public conversations</p></div></header><form className="altara-wave-search" onSubmit={(event) => { event.preventDefault(); setSearchQuery(searchDraft.trim()) }}><Search size={16} /><input value={searchDraft} maxLength={80} placeholder="Search people or posts" onChange={(event) => setSearchDraft(event.target.value)} /><button type="submit">SEARCH</button>{searchQuery ? <button type="button" onClick={() => { setSearchDraft(''); setSearchQuery('') }} aria-label="Clear search"><X size={14} /></button> : null}</form>{directory?.accounts.length ? <section className="altara-wave-people"><header><h2>{searchQuery ? 'PEOPLE' : 'DISCOVER PEOPLE'}</h2></header>{directory.accounts.slice(0, 6).map((person) => <WaveAccountRow key={person.id} account={person} onOpen={() => openProfile(person.id)} busy={Boolean(busyAction)} onFollow={() => { void runAction(`follow:${person.id}`, () => setNetAltaraWaveFollow(expectedIdentityLinkId, account.id, person.id, !person.viewerFollowing)) }} />)}</section> : null}<div className="altara-wave-stream">{page?.posts.map((post) => <WavePostCard key={post.id} post={post} {...postActions} />)}{!page?.posts.length && !directory?.accounts.length && !loading ? <WaveFeedback title={searchQuery ? 'NO RESULTS' : 'THE NETWORK IS QUIET'} copy={searchQuery ? 'Try a different handle, name, or phrase.' : 'New public WAVE profiles and posts will appear here.'} /> : null}{loadMoreButton(Boolean(page?.hasMore))}</div></>
  } else {
    center = <><header className="altara-wave-view-head"><div><h1>{primaryView === 'bookmarks' ? 'Bookmarks' : 'Home'}</h1><p>{primaryView === 'bookmarks' ? 'Your private saved collection' : 'The people and conversations you follow'}</p></div></header>{primaryView === 'home' ? <WaveComposer key={`root:${account.id}`} account={account} presentation={selfPresentation} mode={{ kind: 'root' }} busy={busyAction === 'compose'} onSubmit={async (input) => { if (input.parentPostId !== null) throw new Error('WAVE // ROOT POST TARGET INVALID'); setBusyAction('compose'); try { await submitPost(input) } finally { setBusyAction(undefined) } }} /> : null}<div className="altara-wave-stream">{page?.posts.map((post) => <WavePostCard key={post.id} post={post} {...postActions} />)}{!page?.posts.length && !loading ? <WaveFeedback title={primaryView === 'bookmarks' ? 'NO BOOKMARKS YET' : 'YOUR WAVE STARTS HERE'} copy={primaryView === 'bookmarks' ? 'Save a post to keep it in this private collection.' : 'Post something or follow people from Explore.'} action={primaryView === 'home' ? <button type="button" onClick={() => setScreen({ kind: 'primary', view: 'explore' })}><Users size={14} /> EXPLORE WAVE</button> : undefined} /> : null}{loadMoreButton(Boolean(page?.hasMore))}</div></>
  }

  return (
    <section className="altara-wave" aria-label="WAVE social network">
      <aside className="altara-wave-nav">
        <header><span><AtSign size={20} /></span><div><strong>WAVE</strong><small>ALTARA SOCIAL</small></div></header>
        <nav>{navItems.map(({ id, label, icon: Icon, badge }) => <button key={id} type="button" data-active={primaryView === id ? 'true' : 'false'} onClick={() => { leaveConversation(); setScreen({ kind: 'primary', view: id }) }}><Icon size={18} /><span>{label}</span>{badge ? <b>{Math.min(badge, 99)}</b> : null}</button>)}</nav>
        <button type="button" className="altara-wave-nav__post" onClick={() => { leaveConversation(); setScreen({ kind: 'primary', view: 'home' }); window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.altara-wave-composer textarea')?.focus()) }}><Plus size={16} /> CREATE</button>
        <div className="altara-wave-nav__self-shell">
          <button type="button" className="altara-wave-nav__self" onClick={() => { leaveConversation(); setScreen({ kind: 'primary', view: 'profile' }) }}><WaveAppProfileAvatar displayName={selfPresentation.displayName} avatarUrl={selfPresentation.avatarUrl} size="small" /><span><strong>{selfPresentation.displayName}</strong><small>@{account.handle}</small></span></button>
          <button type="button" className="altara-wave-nav__profile" aria-label={showAppProfile ? 'Close WAVE app profile' : 'Edit WAVE app profile'} aria-expanded={showAppProfile} onClick={() => setShowAppProfile((current) => !current)}><UserCog size={14} aria-hidden="true" /></button>
        </div>
      </aside>
      {appProfileEditor}
      <main className="altara-wave-main" aria-busy={loading}>{loading ? <div className="altara-wave-progress"><i /></div> : null}{center}{error ? <div className="altara-wave-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(undefined)}><X size={14} /></button></div> : null}</main>
      <aside className="altara-wave-rail">
        <section><header><h2>Across WAVE</h2><p>ALTARA-connected identities</p></header>{directory?.accounts.filter((person) => !person.viewerOwns).slice(0, 4).map((person) => <WaveAccountRow key={person.id} account={person} onOpen={() => openProfile(person.id)} />) ?? <p className="altara-wave-rail__empty">Explore the network to find new voices.</p>}</section>
        <footer><strong>ONE ALTARA NETWORK</strong><span>City and location are profile context, never access authority.</span></footer>
      </aside>
    </section>
  )
}
