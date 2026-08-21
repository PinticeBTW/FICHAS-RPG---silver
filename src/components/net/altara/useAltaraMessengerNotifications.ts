import { useEffect, useRef } from 'react'

import { fetchNetAltaraMessengerSidebar } from '../../../lib/netAltaraMessengerService'
import { subscribeToNetAltaraMessenger } from '../../../lib/netAltaraMessengerRealtimeService'
import { playNetMessengerNotificationSound } from '../../../lib/netMessengerNotificationSound'
import type { NetAltaraConversationSummary } from '../../../lib/netAltaraMessengerTypes'

export interface AltaraMessengerIncomingNotification {
  readonly authorDisplayName: string
  readonly conversationTitle: string
  readonly incomingConversationCount: number
}

interface UseAltaraMessengerNotificationsOptions {
  readonly enabled: boolean
  readonly expectedIdentityLinkId?: string
  readonly onIncomingMessage?: (notification: AltaraMessengerIncomingNotification) => void
}

const REFRESH_DEBOUNCE_MS = 180

function newestIncomingConversation(
  conversations: readonly NetAltaraConversationSummary[],
  previousLatestMessageIds: ReadonlyMap<string, string>,
) {
  return conversations
    .filter((conversation) => {
      const latest = conversation.latestMessage
      return Boolean(
        latest
        && !latest.mine
        && latest.messageId !== previousLatestMessageIds.get(conversation.conversationId),
      )
    })
    .sort((left, right) => (
      Date.parse(right.latestMessage!.createdAt) - Date.parse(left.latestMessage!.createdAt)
    ))
}

/**
 * Keeps a lightweight ALTARA Messenger notification listener mounted at the
 * OS level. Realtime exposes only an identity revision; the bounded sidebar
 * RPC remains the authority for deciding whether that revision represents a
 * genuinely new incoming message.
 */
export function useAltaraMessengerNotifications({
  enabled,
  expectedIdentityLinkId,
  onIncomingMessage,
}: UseAltaraMessengerNotificationsOptions) {
  const notificationCallbackRef = useRef(onIncomingMessage)

  useEffect(() => {
    notificationCallbackRef.current = onIncomingMessage
  }, [onIncomingMessage])

  useEffect(() => {
    if (!enabled || !expectedIdentityLinkId) return undefined

    let active = true
    let baselineReady = false
    let refreshTimer: number | null = null
    let requestSequence = 0
    let previousLatestMessageIds = new Map<string, string>()

    const refresh = async () => {
      requestSequence += 1
      const request = requestSequence
      try {
        const payload = await fetchNetAltaraMessengerSidebar(expectedIdentityLinkId)
        if (!active || request !== requestSequence || payload.status !== 'ready') return

        const nextLatestMessageIds = new Map<string, string>()
        for (const conversation of payload.conversations) {
          if (conversation.latestMessage) {
            nextLatestMessageIds.set(conversation.conversationId, conversation.latestMessage.messageId)
          }
        }

        if (baselineReady) {
          const incoming = newestIncomingConversation(payload.conversations, previousLatestMessageIds)
          const newest = incoming[0]
          if (newest?.latestMessage) {
            void playNetMessengerNotificationSound()
            notificationCallbackRef.current?.({
              authorDisplayName: newest.latestMessage.author.displayName,
              conversationTitle: newest.title,
              incomingConversationCount: incoming.length,
            })
          }
        }

        previousLatestMessageIds = nextLatestMessageIds
        baselineReady = true
      } catch {
        // Notification reconciliation is cosmetic. The Messenger's own
        // authoritative loading/error state remains responsible for errors.
      }
    }

    const scheduleRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        void refresh()
      }, REFRESH_DEBOUNCE_MS)
    }

    void refresh()
    let lastStatus = 'idle'
    const unsubscribe = subscribeToNetAltaraMessenger(
      (identityLinkId) => {
        if (identityLinkId === expectedIdentityLinkId) scheduleRefresh()
      },
      (status) => {
        if (status === 'subscribed' && lastStatus === 'disconnected') scheduleRefresh()
        lastStatus = status
      },
    )
    const reconcileOnFocus = () => {
      if (document.visibilityState === 'visible') scheduleRefresh()
    }
    window.addEventListener('focus', reconcileOnFocus)
    document.addEventListener('visibilitychange', reconcileOnFocus)

    return () => {
      active = false
      requestSequence += 1
      unsubscribe()
      window.removeEventListener('focus', reconcileOnFocus)
      document.removeEventListener('visibilitychange', reconcileOnFocus)
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
    }
  }, [enabled, expectedIdentityLinkId])
}
