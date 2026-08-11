import { useCallback, useEffect, useRef, useState } from 'react'

import {
  subscribeToNetNvnInvalidations,
  type NetNvnRealtimeConnectionStatus,
} from '../../lib/netNvnRealtimeService'

const NVN_REALTIME_DEBOUNCE_MS = 500
const NVN_LOCAL_ECHO_WINDOW_MS = 2_000
const NVN_PENDING_MUTATION_EVENT_WINDOW_MS = 60_000

export type NetNvnRealtimeScope = 'article' | 'live' | 'radio'

interface LocalMutationToken {
  readonly id: number
  readonly scope: NetNvnRealtimeScope
  readonly startedAt: number
  eventSeen: boolean
}

export type CompleteNetNvnLocalMutation = (committedChange: boolean) => void

/**
 * Owns NVN's single subscription and converts revision bursts into one local
 * invalidation signal. Local mutation tokens suppress only their matching
 * echo; failed/no-op mutations release any tentatively consumed event.
 */
export function useNetNvnRealtime(enabled: boolean) {
  const [connectionStatus, setConnectionStatus] =
    useState<NetNvnRealtimeConnectionStatus>('idle')
  const [articleInvalidationVersion, setArticleInvalidationVersion] = useState(0)
  const [liveInvalidationVersion, setLiveInvalidationVersion] = useState(0)
  const [radioInvalidationVersion, setRadioInvalidationVersion] = useState(0)
  const debounceTimerRef = useRef<Record<NetNvnRealtimeScope, number | null>>({
    article: null,
    live: null,
    radio: null,
  })
  const everSubscribedRef = useRef(false)
  const activeRef = useRef(false)
  const localMutationSequenceRef = useRef(0)
  const pendingLocalMutationsRef = useRef<LocalMutationToken[]>([])
  const confirmedEchoesRef = useRef<Array<{
    readonly scope: NetNvnRealtimeScope
    readonly confirmedAt: number
  }>>([])
  const lastObservedRevisionRef = useRef<Record<NetNvnRealtimeScope, number>>({
    article: 0,
    live: 0,
    radio: 0,
  })

  const scheduleInvalidation = useCallback((scope: NetNvnRealtimeScope) => {
    const existingTimer = debounceTimerRef.current[scope]
    if (existingTimer !== null) window.clearTimeout(existingTimer)
    debounceTimerRef.current[scope] = window.setTimeout(() => {
      debounceTimerRef.current[scope] = null
      if (!activeRef.current) return
      if (scope === 'article') {
        setArticleInvalidationVersion((version) => version + 1)
      } else if (scope === 'live') {
        setLiveInvalidationVersion((version) => version + 1)
      } else {
        setRadioInvalidationVersion((version) => version + 1)
      }
    }, NVN_REALTIME_DEBOUNCE_MS)
  }, [])

  const beginLocalMutation = useCallback((
    scope: NetNvnRealtimeScope = 'article',
  ): CompleteNetNvnLocalMutation => {
    const token: LocalMutationToken = {
      id: ++localMutationSequenceRef.current,
      scope,
      startedAt: Date.now(),
      eventSeen: false,
    }
    pendingLocalMutationsRef.current.push(token)
    let completed = false

    return (committedChange: boolean) => {
      if (completed) return
      completed = true
      pendingLocalMutationsRef.current = pendingLocalMutationsRef.current
        .filter((candidate) => candidate.id !== token.id)

      if (token.eventSeen) {
        if (!committedChange) scheduleInvalidation(scope)
        return
      }
      if (committedChange) {
        confirmedEchoesRef.current.push({ scope, confirmedAt: Date.now() })
      }
    }
  }, [scheduleInvalidation])

  useEffect(() => {
    if (!enabled) return undefined
    activeRef.current = true
    const debounceTimers = debounceTimerRef.current

    const unsubscribe = subscribeToNetNvnInvalidations(
      (invalidation) => {
        if (!activeRef.current) return
        const changedScopes: NetNvnRealtimeScope[] = []
        if (
          invalidation.articleChanged
          && invalidation.articleRevision > lastObservedRevisionRef.current.article
        ) {
          lastObservedRevisionRef.current.article = invalidation.articleRevision
          changedScopes.push('article')
        }
        if (
          invalidation.liveChanged
          && invalidation.liveRevision > lastObservedRevisionRef.current.live
        ) {
          lastObservedRevisionRef.current.live = invalidation.liveRevision
          changedScopes.push('live')
        }
        if (
          invalidation.radioChanged
          && invalidation.radioRevision > lastObservedRevisionRef.current.radio
        ) {
          lastObservedRevisionRef.current.radio = invalidation.radioRevision
          changedScopes.push('radio')
        }

        for (const scope of changedScopes) {
          const now = Date.now()
          const pendingToken = pendingLocalMutationsRef.current.find((token) => (
            token.scope === scope
            && !token.eventSeen
            && now - token.startedAt <= NVN_PENDING_MUTATION_EVENT_WINDOW_MS
          ))
          if (pendingToken) {
            pendingToken.eventSeen = true
            continue
          }

          confirmedEchoesRef.current = confirmedEchoesRef.current.filter((echo) =>
            now - echo.confirmedAt <= NVN_LOCAL_ECHO_WINDOW_MS)
          const confirmedIndex = confirmedEchoesRef.current.findIndex(
            (echo) => echo.scope === scope,
          )
          if (confirmedIndex >= 0) {
            confirmedEchoesRef.current.splice(confirmedIndex, 1)
            continue
          }
          scheduleInvalidation(scope)
        }
      },
      (status) => {
        if (!activeRef.current) return
        setConnectionStatus(status)
        if (status === 'subscribed') {
          if (everSubscribedRef.current) {
            scheduleInvalidation('article')
            scheduleInvalidation('live')
            scheduleInvalidation('radio')
          }
          everSubscribedRef.current = true
        }
      },
    )

    return () => {
      activeRef.current = false
      for (const scope of ['article', 'live', 'radio'] as const) {
        const timer = debounceTimers[scope]
        if (timer !== null) window.clearTimeout(timer)
        debounceTimers[scope] = null
      }
      pendingLocalMutationsRef.current = []
      confirmedEchoesRef.current = []
      everSubscribedRef.current = false
      unsubscribe()
    }
  }, [enabled, scheduleInvalidation])

  return {
    connectionStatus: enabled ? connectionStatus : 'idle',
    articleInvalidationVersion,
    liveInvalidationVersion,
    radioInvalidationVersion,
    // Kept as a narrow compatibility alias for existing article consumers.
    invalidationVersion: articleInvalidationVersion,
    beginLocalMutation,
  }
}
