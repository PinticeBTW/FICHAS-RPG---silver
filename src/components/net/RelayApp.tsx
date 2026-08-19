import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  LoaderCircle,
  LogOut,
  MessageSquarePlus,
  MessagesSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  Waypoints,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'

import type {
  NetVeilConversationMember,
  NetVeilConversationSummary,
  NetVeilMessengerIdentity,
} from '../../lib/netVeilMessengerTypes'
import { NetAppProfileEditor } from './profile/NetAppProfileEditor'
import { useNetAppPresentation } from './profile/useNetAppIdentityPresentation'
import { useNetVeilMessenger } from './useNetVeilMessenger'

import '../../styles/relay.css'

function initials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'R'
}

function RelayAvatar({ identity, small = false }: {
  readonly identity: NetVeilMessengerIdentity
  readonly small?: boolean
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const avatarUrl = identity.avatarUrl && identity.avatarUrl !== failedUrl
    ? identity.avatarUrl
    : undefined

  return (
    <span className="relay-avatar" data-small={small ? 'true' : 'false'}>
      {avatarUrl
        ? <img src={avatarUrl} alt="" onError={() => setFailedUrl(avatarUrl)} />
        : initials(identity.displayName)}
    </span>
  )
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { day: '2-digit', month: 'short' })
}

function RecipientSearch({
  search,
  excludedIds = [],
  selectedIds = [],
  pending,
  mode,
  onChoose,
}: {
  readonly search: (query: string) => Promise<readonly NetVeilMessengerIdentity[]>
  readonly excludedIds?: readonly string[]
  readonly selectedIds?: readonly string[]
  readonly pending: boolean
  readonly mode: 'direct' | 'multiple'
  readonly onChoose: (identity: NetVeilMessengerIdentity) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly NetVeilMessengerIdentity[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)

  const submit = async () => {
    const trimmed = query.trim()
    if (trimmed.length < 2 || pending || status === 'loading') return
    requestRef.current += 1
    const request = requestRef.current
    setStatus('loading')
    setError(null)
    try {
      const found = await search(trimmed)
      if (requestRef.current !== request) return
      setResults(found.filter((identity) => !excludedIds.includes(identity.identityLinkId)))
      setStatus('ready')
    } catch (searchError) {
      if (requestRef.current !== request) return
      setError(searchError instanceof Error ? searchError.message : 'Directory search failed.')
      setStatus('error')
    }
  }

  return (
    <div className="relay-directory">
      {/* A plain, non-<form> search bar: this component is mounted inside the
          CREATE GROUP <form>, and a nested <form> there let Enter/SEARCH
          bubble into and trigger the outer form's native submission (full
          page reload). Click and Enter both route through the same submit()
          call instead of relying on form-submit semantics. */}
      <div className="relay-search-bar" role="search">
        <Search size={15} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            void submit()
          }}
          placeholder="Search VEIL identities"
          aria-label="Search RELAY identities"
          minLength={2}
          maxLength={80}
        />
        <button type="button" disabled={pending || status === 'loading' || query.trim().length < 2} onClick={() => { void submit() }}>
          {status === 'loading' ? <LoaderCircle className="relay-spin" size={15} aria-hidden="true" /> : 'SEARCH'}
        </button>
      </div>
      {error ? <p className="relay-inline-error" role="alert">{error}</p> : null}
      {status === 'ready' && results.length === 0 ? <p className="relay-directory__empty">No eligible VEIL identity found.</p> : null}
      <div className="relay-directory__results">
        {results.map((identity) => {
          const selected = selectedIds.includes(identity.identityLinkId)
          return (
            <button
              key={identity.identityLinkId}
              type="button"
              disabled={pending}
              data-selected={selected ? 'true' : 'false'}
              onClick={() => onChoose(identity)}
            >
              <RelayAvatar identity={identity} small />
              <span><strong>{identity.displayName}</strong><small>VEGA MESH</small></span>
              {mode === 'multiple'
                ? selected ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />
                : <ChevronRight size={16} aria-hidden="true" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ConversationButton({
  conversation,
  selected,
  onSelect,
}: {
  readonly conversation: NetVeilConversationSummary
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  const recipient = conversation.directRecipient
  return (
    <button
      type="button"
      className="relay-thread"
      data-selected={selected ? 'true' : 'false'}
      onClick={onSelect}
      aria-current={selected ? 'page' : undefined}
    >
      {recipient ? <RelayAvatar identity={recipient} /> : (
        <span className="relay-avatar"><Users size={17} aria-hidden="true" /></span>
      )}
      <span className="relay-thread__copy">
        <span><strong>{conversation.title}</strong><time>{conversation.latestMessage ? formatTime(conversation.latestMessage.createdAt) : ''}</time></span>
        <small>{conversation.latestMessage
          ? `${conversation.latestMessage.mine ? 'You: ' : ''}${conversation.latestMessage.body}`
          : conversation.kind === 'group' ? `${conversation.memberCount} members` : 'Start the conversation'}</small>
      </span>
      {conversation.unreadCount > 0 ? (
        <span className="relay-thread__unread" aria-label={`${conversation.unreadCount}${conversation.unreadCapped ? ' or more' : ''} unread messages`}>
          {conversation.unreadCapped ? '99+' : conversation.unreadCount}
        </span>
      ) : null}
    </button>
  )
}

function IdentityRequiredState() {
  return (
    <div className="relay-system-state">
      <span><ShieldCheck size={24} aria-hidden="true" /></span>
      <h2>No controlled communications identity</h2>
      <p>TAKE CONTROL or ACT AS an eligible VEIL identity to access RELAY.</p>
      <small>GM SYSTEM does not create or inherit a fictional RELAY identity.</small>
    </div>
  )
}

export function RelayApp({
  enabled,
  expectedIdentityLinkId,
}: {
  readonly enabled: boolean
  readonly expectedIdentityLinkId?: string
}) {
  const messenger = useNetVeilMessenger({ enabled, expectedIdentityLinkId })
  const [filter, setFilter] = useState('')
  const [flow, setFlow] = useState<'direct' | 'group' | null>(null)
  const [groupTitle, setGroupTitle] = useState('')
  const [groupMembers, setGroupMembers] = useState<readonly NetVeilMessengerIdentity[]>([])
  const [draft, setDraft] = useState('')
  const [manageGroup, setManageGroup] = useState(false)
  const [showConversationInfo, setShowConversationInfo] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showAppProfile, setShowAppProfile] = useState(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  const stayAtBottomRef = useRef(true)

  const readySession = messenger.session.status === 'ready' ? messenger.session : null
  const selfIdentityLinkId = readySession?.identity.identityLinkId ?? expectedIdentityLinkId
  const selfPresentation = useNetAppPresentation({
    appId: 'relay',
    identityLinkId: selfIdentityLinkId,
    enabled,
    fallbackDisplayName: readySession?.identity.displayName,
    fallbackAvatarUrl: readySession?.identity.avatarUrl,
  })
  const readyConversation = messenger.conversation.status === 'ready' ? messenger.conversation : null
  const activeConversationId = readyConversation?.conversation.conversationId
  const newestMessageId = readyConversation?.messages.at(-1)?.messageId
  const failedConversationId = messenger.conversation.status === 'error'
    ? messenger.conversation.conversationId
    : null
  const filteredConversations = useMemo(() => {
    if (!readySession) return []
    const normalized = filter.trim().toLocaleLowerCase()
    if (!normalized) return readySession.conversations
    return readySession.conversations.filter((conversation) => (
      conversation.title.toLocaleLowerCase().includes(normalized)
      || conversation.latestMessage?.body.toLocaleLowerCase().includes(normalized)
    ))
  }, [filter, readySession])

  useEffect(() => {
    if (!activeConversationId || !timelineRef.current) return
    if (stayAtBottomRef.current) {
      window.requestAnimationFrame(() => {
        timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight })
      })
    }
  }, [activeConversationId, newestMessageId])

  if (!enabled) {
    return <div className="relay-loading"><LoaderCircle className="relay-spin" size={22} aria-hidden="true" /><span>OPENING RELAY</span></div>
  }
  if (messenger.session.status === 'identity-required') {
    return <IdentityRequiredState />
  }
  if (messenger.session.status === 'loading') {
    return <div className="relay-loading"><LoaderCircle className="relay-spin" size={22} aria-hidden="true" /><span>SYNCING RELAY</span></div>
  }
  if (messenger.session.status === 'error') {
    return (
      <div className="relay-system-state" role="alert">
        <span><AlertTriangle size={24} aria-hidden="true" /></span>
        <h2>RELAY unavailable</h2>
        <p>{messenger.session.reason}</p>
        <button type="button" onClick={messenger.retry}><RefreshCw size={14} aria-hidden="true" /> RETRY</button>
      </div>
    )
  }

  const sessionIdentity = messenger.session.identity
  const effectiveSelfDisplayName = selfPresentation.status === 'ready' && selfPresentation.displayName.trim()
    ? selfPresentation.displayName
    : sessionIdentity.displayName
  const effectiveSelfAvatarUrl = selfPresentation.avatarUrl ?? sessionIdentity.avatarUrl
  const effectiveSelfIdentity: NetVeilMessengerIdentity = {
    identityLinkId: sessionIdentity.identityLinkId,
    displayName: effectiveSelfDisplayName,
    ...(effectiveSelfAvatarUrl ? { avatarUrl: effectiveSelfAvatarUrl } : {}),
  }
  const currentConversation = readyConversation?.conversation
  const groupOwner = currentConversation?.kind === 'group' && currentConversation.role === 'owner'
  const groupNonOwnerMember = currentConversation?.kind === 'group' && currentConversation.role !== 'owner'
  const existingMemberIds = currentConversation?.members.map((member) => member.identity.identityLinkId) ?? []

  const chooseDirect = async (recipient: NetVeilMessengerIdentity) => {
    try {
      await messenger.ensureDirect(recipient.identityLinkId)
      setFlow(null)
    } catch {
      // The hook exposes the server error in the app's persistent status area.
    }
  }

  const submitGroup = async (event: FormEvent) => {
    event.preventDefault()
    if (!groupTitle.trim() || groupMembers.length === 0) return
    try {
      await messenger.createGroup(groupTitle.trim(), groupMembers.map((member) => member.identityLinkId))
      setFlow(null)
      setGroupTitle('')
      setGroupMembers([])
    } catch {
      // The hook exposes the authoritative failure.
    }
  }

  const confirmLeaveGroup = async () => {
    if (!currentConversation) return
    try {
      await messenger.leaveGroup(currentConversation.conversationId)
      setConfirmLeave(false)
    } catch {
      // The hook exposes the authoritative failure via messenger.actionError.
    }
  }

  const confirmDeleteGroup = async () => {
    if (!currentConversation) return
    try {
      await messenger.deleteGroup(currentConversation.conversationId)
      setConfirmDelete(false)
      setManageGroup(false)
    } catch {
      // The hook exposes the authoritative failure via messenger.actionError.
    }
  }

  const submitMessage = async () => {
    if (!draft.trim()) return
    const sent = await messenger.sendMessage(draft)
    if (sent) {
      setDraft('')
      stayAtBottomRef.current = true
    }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void submitMessage()
  }

  return (
    <div className="relay" data-thread-open={messenger.selectedConversationId || flow ? 'true' : 'false'}>
      <aside className="relay-sidebar">
        <header className="relay-identity">
          <RelayAvatar
            key={`${effectiveSelfIdentity.identityLinkId}:${effectiveSelfIdentity.avatarUrl ?? 'initials'}`}
            identity={effectiveSelfIdentity}
          />
          <span><small>VEIL IDENTITY</small><strong>{effectiveSelfIdentity.displayName}</strong></span>
          <button
            type="button"
            className="relay-identity__edit"
            aria-label={showAppProfile ? 'Close RELAY app profile' : 'Edit RELAY app profile'}
            aria-expanded={showAppProfile}
            onClick={() => setShowAppProfile((current) => !current)}
          ><UserCog size={14} aria-hidden="true" /></button>
          <i
            role="status"
            aria-label={messenger.realtimeStatus === 'subscribed' ? 'Live updates connected' : 'Live updates reconnecting'}
            title={messenger.realtimeStatus === 'subscribed' ? 'Live updates connected' : 'Live updates reconnecting'}
            data-online={messenger.realtimeStatus === 'subscribed' ? 'true' : 'false'}
          />
        </header>
        {showAppProfile ? (
          <div className="relay-app-profile">
            <NetAppProfileEditor
              appId="relay"
              appLabel="RELAY"
              identityLinkId={expectedIdentityLinkId}
              onClose={() => setShowAppProfile(false)}
              onSaved={() => {
                void selfPresentation.reload()
                messenger.retry()
              }}
            />
          </div>
        ) : null}
        <div className="relay-sidebar__actions">
          <button type="button" onClick={() => setFlow('direct')}><MessageSquarePlus size={15} aria-hidden="true" /> NEW MESSAGE</button>
          <button type="button" onClick={() => setFlow('group')}><Users size={15} aria-hidden="true" /> NEW GROUP</button>
        </div>
        <label className="relay-filter">
          <Search size={14} aria-hidden="true" />
          <input aria-label="Filter conversations" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter conversations" />
        </label>
        <div className="relay-sidebar__label"><span>CONVERSATIONS</span><small>{messenger.session.conversations.length}</small></div>
        <nav aria-label="RELAY conversations">
          {filteredConversations.map((conversation) => (
            <ConversationButton
              key={conversation.conversationId}
              conversation={conversation}
              selected={messenger.selectedConversationId === conversation.conversationId}
              onSelect={() => {
                setFlow(null)
                setManageGroup(false)
                setShowConversationInfo(false)
                setConfirmLeave(false)
                setConfirmDelete(false)
                messenger.selectConversation(conversation.conversationId)
              }}
            />
          ))}
          {messenger.session.conversations.length === 0 ? (
            <p className="relay-sidebar__empty">No conversations yet.<br />Start with a VEIL contact.</p>
          ) : filteredConversations.length === 0 ? (
            <p className="relay-sidebar__empty">No matching conversation.</p>
          ) : null}
        </nav>
      </aside>

      <main className="relay-main">
        {flow === 'direct' ? (
          <section className="relay-compose-flow" aria-labelledby="relay-new-message-title">
            <button type="button" className="relay-back" onClick={() => setFlow(null)}><ArrowLeft size={15} aria-hidden="true" /> BACK</button>
            <h2 id="relay-new-message-title">New message</h2>
            <span>Search the authoritative VEIL directory. Only current RELAY identities are shown.</span>
            <RecipientSearch search={messenger.searchRecipients} pending={messenger.actionPending} mode="direct" onChoose={(recipient) => { void chooseDirect(recipient) }} />
          </section>
        ) : flow === 'group' ? (
          <section className="relay-compose-flow" aria-labelledby="relay-new-group-title">
            <button type="button" className="relay-back" onClick={() => setFlow(null)}><ArrowLeft size={15} aria-hidden="true" /> BACK</button>
            <h2 id="relay-new-group-title">Create conversation</h2>
            <form className="relay-group-form" onSubmit={(event) => { void submitGroup(event) }}>
              <label>GROUP TITLE<input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} maxLength={80} placeholder="Crew, district or destination" /></label>
              {groupMembers.length ? (
                <div className="relay-selected" aria-label="Selected group participants">
                  {groupMembers.map((member) => (
                    <button key={member.identityLinkId} type="button" onClick={() => setGroupMembers((current) => current.filter((item) => item.identityLinkId !== member.identityLinkId))}>
                      {member.displayName}<X size={12} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : null}
              <RecipientSearch
                search={messenger.searchRecipients}
                selectedIds={groupMembers.map((member) => member.identityLinkId)}
                pending={messenger.actionPending}
                mode="multiple"
                onChoose={(recipient) => setGroupMembers((current) => current.some((member) => member.identityLinkId === recipient.identityLinkId)
                  ? current.filter((member) => member.identityLinkId !== recipient.identityLinkId)
                  : current.length >= 15 ? current : [...current, recipient])}
              />
              <button className="relay-primary" type="submit" disabled={messenger.actionPending || !groupTitle.trim() || groupMembers.length === 0}>
                {messenger.actionPending ? 'CREATING…' : `CREATE GROUP · ${groupMembers.length + 1}`}
              </button>
            </form>
          </section>
        ) : messenger.conversation.status === 'loading' ? (
          <div className="relay-loading"><LoaderCircle className="relay-spin" size={22} aria-hidden="true" /><span>OPENING CONVERSATION</span></div>
        ) : messenger.conversation.status === 'error' ? (
          <div className="relay-system-state" role="alert">
            <span><AlertTriangle size={22} aria-hidden="true" /></span><h2>Conversation unavailable</h2><p>{messenger.conversation.reason}</p>
            <button type="button" onClick={() => messenger.selectConversation(failedConversationId)}><RefreshCw size={14} aria-hidden="true" /> RETRY</button>
          </div>
        ) : currentConversation && readyConversation ? (
          <>
            <header className="relay-conversation-header">
              <button type="button" className="relay-mobile-back" onClick={() => messenger.selectConversation(null)} aria-label="Back to conversations"><ArrowLeft size={17} aria-hidden="true" /></button>
              <div>
                <small>{currentConversation.kind === 'group' ? `${currentConversation.members.length} MEMBERS` : 'VERIFIED LOCAL IDENTITY'}</small>
                <h2>{currentConversation.title}</h2>
              </div>
              <button
                type="button"
                className="relay-info-toggle"
                aria-expanded={showConversationInfo}
                onClick={() => setShowConversationInfo((current) => !current)}
              ><Users size={16} aria-hidden="true" /><span>DETAILS</span></button>
            </header>
            <div
              ref={timelineRef}
              className="relay-timeline"
              onScroll={(event) => {
                const element = event.currentTarget
                stayAtBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96
              }}
            >
              {readyConversation.nextCursor ? <button type="button" className="relay-load-earlier" disabled={messenger.actionPending} onClick={() => { void messenger.loadEarlier() }}>LOAD EARLIER</button> : null}
              {readyConversation.messages.length === 0 ? (
                <div className="relay-timeline__empty"><MessagesSquare size={22} aria-hidden="true" /><p>No messages yet.</p><small>Start this private RELAY conversation.</small></div>
              ) : readyConversation.messages.map((message) => (
                <article key={message.messageId} className="relay-message" data-mine={message.mine ? 'true' : 'false'}>
                  {!message.mine && currentConversation.kind === 'group' ? <strong>{message.author.displayName}</strong> : null}
                  <p>{message.body}</p>
                  <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                </article>
              ))}
            </div>
            <div className="relay-composer">
              {!currentConversation.canSend ? <p role="status">This conversation is dormant because a member no longer has RELAY access.</p> : null}
              <div>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onComposerKeyDown}
                  placeholder={currentConversation.canSend ? 'Write a message' : 'Messaging unavailable'}
                  aria-label="Message"
                  maxLength={4000}
                  rows={1}
                  disabled={!currentConversation.canSend || messenger.actionPending}
                />
                <span>{draft.length}/4000</span>
                <button type="button" disabled={!currentConversation.canSend || messenger.actionPending || !draft.trim()} onClick={() => { void submitMessage() }} aria-label="Send message">
                  {messenger.actionPending ? <LoaderCircle className="relay-spin" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="relay-welcome">
            <span><Waypoints size={28} aria-hidden="true" /></span>
            <h2>Vega Mesh, secured.</h2>
            <p>Select a conversation or begin a private connection across the VEIL civic network.</p>
            <div><button type="button" onClick={() => setFlow('direct')}><MessageSquarePlus size={15} aria-hidden="true" /> NEW MESSAGE</button><button type="button" onClick={() => setFlow('group')}><Users size={15} aria-hidden="true" /> NEW GROUP</button></div>
          </div>
        )}
        {messenger.actionError ? <p className="relay-action-error" role="alert"><AlertTriangle size={13} aria-hidden="true" /> {messenger.actionError}</p> : null}
      </main>

      {currentConversation && readyConversation ? (
        <aside className="relay-info" data-open={showConversationInfo ? 'true' : 'false'}>
          <header>
            <div><small>{currentConversation.kind === 'group' ? 'CONVERSATION' : 'CONNECTION'}</small><h3>{currentConversation.title}</h3></div>
            <button type="button" className="relay-info-close" onClick={() => setShowConversationInfo(false)} aria-label="Close conversation details"><X size={15} aria-hidden="true" /></button>
          </header>
          <section>
            <p>PARTICIPANTS</p>
            {currentConversation.members.map((member: NetVeilConversationMember) => (
              <div key={member.identity.identityLinkId} className="relay-member">
                <RelayAvatar identity={member.identity} small />
                <span><strong>{member.identity.displayName}</strong><small>{member.role === 'owner' ? 'OWNER' : member.available ? 'VEGA MESH' : 'ACCESS DORMANT'}</small></span>
                {groupOwner && member.role !== 'owner' ? (
                  <button type="button" disabled={messenger.actionPending} onClick={() => { void messenger.removeGroupMember(currentConversation.conversationId, member.identity.identityLinkId).catch(() => {}) }} aria-label={`Remove ${member.identity.displayName} from group`}><X size={13} aria-hidden="true" /></button>
                ) : null}
              </div>
            ))}
          </section>
          {groupOwner ? (
            <section className="relay-manage">
              <button type="button" onClick={() => {
                if (!manageGroup) setRenameDraft(currentConversation.title)
                setManageGroup((current) => !current)
              }} aria-expanded={manageGroup}><UserPlus size={14} aria-hidden="true" /> MANAGE GROUP</button>
              {manageGroup ? (
                <div>
                  <form onSubmit={(event) => {
                    event.preventDefault()
                    if (!renameDraft.trim()) return
                    void messenger.renameGroup(currentConversation.conversationId, renameDraft.trim()).catch(() => {})
                  }}>
                    <label>GROUP TITLE<input value={renameDraft} maxLength={80} onChange={(event) => setRenameDraft(event.target.value)} /></label>
                    <button type="submit" disabled={messenger.actionPending || !renameDraft.trim()}>SAVE TITLE</button>
                  </form>
                  <RecipientSearch
                    search={messenger.searchRecipients}
                    excludedIds={existingMemberIds}
                    pending={messenger.actionPending}
                    mode="direct"
                    onChoose={(recipient) => { void messenger.addGroupMembers(currentConversation.conversationId, [recipient.identityLinkId]).catch(() => {}) }}
                  />
                  <div className="relay-danger-zone">
                    {!confirmDelete ? (
                      <button type="button" className="relay-danger" disabled={messenger.actionPending} onClick={() => setConfirmDelete(true)}>
                        <Trash2 size={14} aria-hidden="true" /> DELETE GROUP
                      </button>
                    ) : (
                      <div className="relay-confirm" role="alertdialog" aria-label="Confirm group deletion">
                        <p>Permanently delete <strong>{currentConversation.title}</strong> and its conversation history for everyone? This cannot be undone.</p>
                        <div>
                          <button type="button" disabled={messenger.actionPending} onClick={() => setConfirmDelete(false)}>CANCEL</button>
                          <button type="button" className="relay-danger" disabled={messenger.actionPending} onClick={() => { void confirmDeleteGroup() }}>
                            {messenger.actionPending ? 'DELETING…' : 'CONFIRM DELETE'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
          {groupNonOwnerMember ? (
            <section className="relay-manage relay-danger-zone">
              {!confirmLeave ? (
                <button type="button" className="relay-danger" disabled={messenger.actionPending} onClick={() => setConfirmLeave(true)}>
                  <LogOut size={14} aria-hidden="true" /> LEAVE GROUP
                </button>
              ) : (
                <div className="relay-confirm" role="alertdialog" aria-label="Confirm leaving group">
                  <p>Leave <strong>{currentConversation.title}</strong>? You will no longer see its messages or membership.</p>
                  <div>
                    <button type="button" disabled={messenger.actionPending} onClick={() => setConfirmLeave(false)}>CANCEL</button>
                    <button type="button" className="relay-danger" disabled={messenger.actionPending} onClick={() => { void confirmLeaveGroup() }}>
                      {messenger.actionPending ? 'LEAVING…' : 'CONFIRM LEAVE'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          ) : null}
          <footer><ShieldCheck size={14} aria-hidden="true" /><span>VEGA MESH<br /><small>SERVER VERIFIED</small></span></footer>
        </aside>
      ) : null}
    </div>
  )
}
