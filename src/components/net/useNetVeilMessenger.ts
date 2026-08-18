import { useCallback, useEffect, useRef, useState } from 'react'

import {
  addNetVeilGroupMembers,
  createNetVeilGroup,
  deleteNetVeilGroup,
  ensureNetVeilDirectConversation,
  fetchNetVeilMessagePage,
  fetchNetVeilMessengerSidebar,
  leaveNetVeilGroup,
  markNetVeilConversationRead,
  removeNetVeilGroupMember,
  renameNetVeilGroup,
  searchNetVeilMessengerRecipients,
  sendNetVeilMessage,
} from '../../lib/netVeilMessengerService'
import { subscribeToNetVeilMessenger } from '../../lib/netVeilMessengerRealtimeService'
import type {
  NetVeilConversationDetail,
  NetVeilConversationSummary,
  NetVeilMessage,
  NetVeilMessageCursor,
  NetVeilMessengerIdentity,
  NetVeilMessengerRealtimeStatus,
} from '../../lib/netVeilMessengerTypes'

type MessengerSessionState =
  | { readonly status: 'identity-required' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly identity: NetVeilMessengerIdentity
      readonly conversations: readonly NetVeilConversationSummary[]
    }
  | { readonly status: 'error'; readonly reason: string }

type ConversationState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly conversationId: string }
  | {
      readonly status: 'ready'
      readonly conversation: NetVeilConversationDetail
      readonly messages: readonly NetVeilMessage[]
      readonly nextCursor?: NetVeilMessageCursor
    }
  | { readonly status: 'error'; readonly conversationId: string; readonly reason: string }

interface ReadObservation {
  readonly expectedIdentityLinkId: string
  readonly conversationId: string
  readonly messageId: string
  readonly generation: number
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function mergeMessages(
  existing: readonly NetVeilMessage[],
  incoming: readonly NetVeilMessage[],
) {
  const byId = new Map<string, NetVeilMessage>()
  for (const message of [...existing, ...incoming]) byId.set(message.messageId, message)
  return [...byId.values()].sort((left, right) => {
    const timestampOrder = Date.parse(left.createdAt) - Date.parse(right.createdAt)
    return timestampOrder || left.messageId.localeCompare(right.messageId)
  })
}

export function useNetVeilMessenger({
  enabled,
  expectedIdentityLinkId,
}: {
  readonly enabled: boolean
  readonly expectedIdentityLinkId?: string
}) {
  const [session, setSession] = useState<MessengerSessionState>(
    expectedIdentityLinkId ? { status: 'loading' } : { status: 'identity-required' },
  )
  const [conversation, setConversation] = useState<ConversationState>({ status: 'idle' })
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<NetVeilMessengerRealtimeStatus>('idle')
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [readObservation, setReadObservation] = useState<ReadObservation | null>(null)
  const generationRef = useRef(0)
  const sidebarRequestRef = useRef(0)
  const conversationRequestRef = useRef(0)
  const selectedConversationIdRef = useRef<string | null>(null)
  const revisionTimerRef = useRef<number | null>(null)
  const mutationInFlightRef = useRef(false)
  const sendRequestRef = useRef<{
    readonly conversationId: string
    readonly body: string
    readonly requestKey: string
  } | null>(null)

  selectedConversationIdRef.current = selectedConversationId

  const loadSidebar = useCallback(async (generation: number, showLoading: boolean) => {
    if (!enabled || !expectedIdentityLinkId) return
    sidebarRequestRef.current += 1
    const request = sidebarRequestRef.current
    if (showLoading) setSession({ status: 'loading' })
    try {
      const payload = await fetchNetVeilMessengerSidebar(expectedIdentityLinkId)
      if (generationRef.current !== generation || sidebarRequestRef.current !== request) return
      if (payload.status === 'identity-required') {
        setSession({ status: 'identity-required' })
        setConversation({ status: 'idle' })
        setReadObservation(null)
        setSelectedConversationId(null)
        return
      }
      setSession({
        status: 'ready',
        identity: payload.identity,
        conversations: payload.conversations,
      })
      const selected = selectedConversationIdRef.current
      if (selected && !payload.conversations.some((item) => item.conversationId === selected)) {
        setSelectedConversationId(null)
        setConversation({ status: 'idle' })
        setReadObservation(null)
      }
    } catch (error) {
      if (generationRef.current !== generation || sidebarRequestRef.current !== request) return
      setSession({ status: 'error', reason: errorMessage(error, 'RELAY could not load.') })
      setConversation({ status: 'idle' })
      setReadObservation(null)
    }
  }, [enabled, expectedIdentityLinkId])

  const loadConversation = useCallback(async (
    conversationId: string,
    generation: number,
    mode: 'replace' | 'merge' = 'replace',
  ) => {
    if (!enabled || !expectedIdentityLinkId) return
    conversationRequestRef.current += 1
    const request = conversationRequestRef.current
    if (mode === 'replace') setConversation({ status: 'loading', conversationId })
    try {
      const page = await fetchNetVeilMessagePage(expectedIdentityLinkId, conversationId)
      if (
        generationRef.current !== generation
        || conversationRequestRef.current !== request
        || selectedConversationIdRef.current !== conversationId
      ) return
      setConversation((current) => ({
        status: 'ready',
        conversation: page.conversation,
        messages: mode === 'merge' && current.status === 'ready'
          ? mergeMessages(current.messages, page.messages)
          : page.messages,
        ...(mode === 'merge' && current.status === 'ready' && current.nextCursor
          ? { nextCursor: current.nextCursor }
          : page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      }))
      const newestFetchedMessage = page.messages.at(-1)
      if (newestFetchedMessage) {
        setReadObservation({
          expectedIdentityLinkId,
          conversationId,
          messageId: newestFetchedMessage.messageId,
          generation,
        })
      } else if (mode === 'replace') {
        setReadObservation(null)
      }
    } catch (error) {
      if (
        generationRef.current !== generation
        || conversationRequestRef.current !== request
        || selectedConversationIdRef.current !== conversationId
      ) return
      setConversation({
        status: 'error',
        conversationId,
        reason: errorMessage(error, 'This conversation is no longer available.'),
      })
      setReadObservation(null)
    }
  }, [enabled, expectedIdentityLinkId])

  const reconcile = useCallback((showLoading = false) => {
    const generation = generationRef.current
    void loadSidebar(generation, showLoading)
    const selected = selectedConversationIdRef.current
    if (selected) void loadConversation(selected, generation, 'merge')
  }, [loadConversation, loadSidebar])

  const readObservationIsRendered = readObservation !== null
    && conversation.status === 'ready'
    && conversation.conversation.conversationId === readObservation.conversationId
    && conversation.messages.some((message) => message.messageId === readObservation.messageId)

  useEffect(() => {
    if (
      !enabled
      || !readObservation
      || !readObservationIsRendered
      || readObservation.expectedIdentityLinkId !== expectedIdentityLinkId
      || readObservation.generation !== generationRef.current
      || selectedConversationIdRef.current !== readObservation.conversationId
    ) return

    void markNetVeilConversationRead(
      readObservation.expectedIdentityLinkId,
      readObservation.conversationId,
      readObservation.messageId,
    ).catch(() => {
      // A failed receipt never invalidates successfully fetched text. The next
      // bounded fetch/focus reconciliation emits a fresh observation and retry.
    })
  }, [enabled, expectedIdentityLinkId, readObservation, readObservationIsRendered])

  useEffect(() => {
    generationRef.current += 1
    sidebarRequestRef.current += 1
    conversationRequestRef.current += 1
    const generation = generationRef.current
    setActionPending(false)
    setActionError(null)
    mutationInFlightRef.current = false
    sendRequestRef.current = null
    setReadObservation(null)
    setSelectedConversationId(null)
    selectedConversationIdRef.current = null
    setConversation({ status: 'idle' })
    setRealtimeStatus('idle')

    if (!enabled) {
      setSession(expectedIdentityLinkId ? { status: 'loading' } : { status: 'identity-required' })
      return undefined
    }
    if (!expectedIdentityLinkId) {
      setSession({ status: 'identity-required' })
      return undefined
    }

    void loadSidebar(generation, true)
    let lastRealtimeStatus: NetVeilMessengerRealtimeStatus = 'idle'
    const unsubscribe = subscribeToNetVeilMessenger(
      (identityLinkId) => {
        if (identityLinkId !== expectedIdentityLinkId || generationRef.current !== generation) return
        if (revisionTimerRef.current !== null) window.clearTimeout(revisionTimerRef.current)
        revisionTimerRef.current = window.setTimeout(() => {
          revisionTimerRef.current = null
          if (generationRef.current === generation) reconcile(false)
        }, 180)
      },
      (status) => {
        if (generationRef.current !== generation) return
        setRealtimeStatus(status)
        // A membership change delivered while disconnected is never
        // replayed. Force a reconciliation on every reconnect so a former
        // group member's already-open view cannot outlive a missed
        // revision bump.
        if (status === 'subscribed' && lastRealtimeStatus !== 'subscribed') reconcile(false)
        lastRealtimeStatus = status
      },
    )
    const onFocus = () => {
      if (document.visibilityState === 'visible' && generationRef.current === generation) reconcile(false)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      if (revisionTimerRef.current !== null) {
        window.clearTimeout(revisionTimerRef.current)
        revisionTimerRef.current = null
      }
    }
  }, [enabled, expectedIdentityLinkId, loadSidebar, reconcile])

  const selectConversation = useCallback((conversationId: string | null) => {
    setActionError(null)
    setSelectedConversationId(conversationId)
    selectedConversationIdRef.current = conversationId
    if (!conversationId) {
      setConversation({ status: 'idle' })
      setReadObservation(null)
      return
    }
    setReadObservation(null)
    void loadConversation(conversationId, generationRef.current)
  }, [loadConversation])

  const runConversationMutation = useCallback(async (
    operation: () => Promise<{ readonly conversationId: string }>,
    focusResult = false,
  ) => {
    if (!expectedIdentityLinkId) throw new Error('No controlled VEIL RELAY identity is active.')
    if (mutationInFlightRef.current) throw new Error('A RELAY request is already in progress.')
    const generation = generationRef.current
    mutationInFlightRef.current = true
    setActionPending(true)
    setActionError(null)
    try {
      const result = await operation()
      if (generationRef.current !== generation) throw new Error('RELAY identity changed. Retry in the current session.')
      await loadSidebar(generation, false)
      if (focusResult) selectConversation(result.conversationId)
      else if (selectedConversationIdRef.current === result.conversationId) {
        await loadConversation(result.conversationId, generation, 'merge')
      }
      return result
    } catch (error) {
      const message = errorMessage(error, 'RELAY could not complete that request.')
      if (generationRef.current === generation) setActionError(message)
      throw error
    } finally {
      mutationInFlightRef.current = false
      if (generationRef.current === generation) setActionPending(false)
    }
  }, [expectedIdentityLinkId, loadConversation, loadSidebar, selectConversation])

  // Leaving or deleting a group never re-selects or reloads that
  // conversation the way runConversationMutation does for create/rename/add
  // -- if it was open, it must be cleared instead so no stale content can
  // flash before the sidebar reconciles.
  const runDepartureMutation = useCallback(async (
    conversationId: string,
    operation: () => Promise<void>,
  ) => {
    if (!expectedIdentityLinkId) throw new Error('No controlled VEIL RELAY identity is active.')
    if (mutationInFlightRef.current) throw new Error('A RELAY request is already in progress.')
    const generation = generationRef.current
    mutationInFlightRef.current = true
    setActionPending(true)
    setActionError(null)
    try {
      await operation()
      if (generationRef.current !== generation) return
      if (selectedConversationIdRef.current === conversationId) {
        setSelectedConversationId(null)
        selectedConversationIdRef.current = null
        setConversation({ status: 'idle' })
        setReadObservation(null)
      }
      await loadSidebar(generation, false)
    } catch (error) {
      const message = errorMessage(error, 'RELAY could not complete that request.')
      if (generationRef.current === generation) setActionError(message)
      throw error
    } finally {
      mutationInFlightRef.current = false
      if (generationRef.current === generation) setActionPending(false)
    }
  }, [expectedIdentityLinkId, loadSidebar])

  const loadEarlier = useCallback(async () => {
    if (!expectedIdentityLinkId || conversation.status !== 'ready' || !conversation.nextCursor) return
    const generation = generationRef.current
    setActionPending(true)
    setActionError(null)
    try {
      const page = await fetchNetVeilMessagePage(
        expectedIdentityLinkId,
        conversation.conversation.conversationId,
        conversation.nextCursor,
      )
      if (generationRef.current !== generation || selectedConversationIdRef.current !== page.conversation.conversationId) return
      setConversation((current) => current.status === 'ready' ? {
        ...current,
        messages: mergeMessages(page.messages, current.messages),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : { nextCursor: undefined }),
      } : current)
    } catch (error) {
      if (generationRef.current === generation) setActionError(errorMessage(error, 'Earlier messages could not load.'))
    } finally {
      if (generationRef.current === generation) setActionPending(false)
    }
  }, [conversation, expectedIdentityLinkId])

  const sendMessage = useCallback(async (body: string) => {
    if (!expectedIdentityLinkId || conversation.status !== 'ready') return false
    const trimmedBody = body.trim()
    if (!trimmedBody || mutationInFlightRef.current) return false
    const generation = generationRef.current
    const conversationId = conversation.conversation.conversationId
    const existingRequest = sendRequestRef.current
    const request = existingRequest
      && existingRequest.conversationId === conversationId
      && existingRequest.body === trimmedBody
      ? existingRequest
      : { conversationId, body: trimmedBody, requestKey: crypto.randomUUID() }
    sendRequestRef.current = request
    mutationInFlightRef.current = true
    setActionPending(true)
    setActionError(null)
    try {
      const sent = await sendNetVeilMessage(
        expectedIdentityLinkId,
        conversationId,
        trimmedBody,
        request.requestKey,
      )
      if (generationRef.current !== generation) return false
      setConversation((current) => current.status === 'ready' ? {
        ...current,
        messages: mergeMessages(current.messages, [sent]),
      } : current)
      sendRequestRef.current = null
      await loadSidebar(generation, false)
      return true
    } catch (error) {
      if (generationRef.current === generation) setActionError(errorMessage(error, 'Message could not be sent.'))
      return false
    } finally {
      mutationInFlightRef.current = false
      if (generationRef.current === generation) setActionPending(false)
    }
  }, [conversation, expectedIdentityLinkId, loadSidebar])

  return {
    session,
    conversation,
    selectedConversationId,
    realtimeStatus,
    actionPending,
    actionError,
    selectConversation,
    retry: () => reconcile(true),
    loadEarlier,
    sendMessage,
    searchRecipients: (query: string) => {
      if (!expectedIdentityLinkId) return Promise.resolve([] as readonly NetVeilMessengerIdentity[])
      return searchNetVeilMessengerRecipients(expectedIdentityLinkId, query)
    },
    ensureDirect: (recipientIdentityLinkId: string) => runConversationMutation(
      () => ensureNetVeilDirectConversation(expectedIdentityLinkId!, recipientIdentityLinkId),
      true,
    ),
    createGroup: (title: string, memberIdentityLinkIds: readonly string[]) => runConversationMutation(
      () => createNetVeilGroup(expectedIdentityLinkId!, title, memberIdentityLinkIds),
      true,
    ),
    renameGroup: (conversationId: string, title: string) => runConversationMutation(
      () => renameNetVeilGroup(expectedIdentityLinkId!, conversationId, title),
    ),
    addGroupMembers: (conversationId: string, memberIdentityLinkIds: readonly string[]) => runConversationMutation(
      () => addNetVeilGroupMembers(expectedIdentityLinkId!, conversationId, memberIdentityLinkIds),
    ),
    removeGroupMember: (conversationId: string, memberIdentityLinkId: string) => runConversationMutation(
      () => removeNetVeilGroupMember(expectedIdentityLinkId!, conversationId, memberIdentityLinkId),
    ),
    leaveGroup: (conversationId: string) => runDepartureMutation(
      conversationId,
      () => leaveNetVeilGroup(expectedIdentityLinkId!, conversationId).then(() => undefined),
    ),
    deleteGroup: (conversationId: string) => runDepartureMutation(
      conversationId,
      () => deleteNetVeilGroup(expectedIdentityLinkId!, conversationId).then(() => undefined),
    ),
  }
}
