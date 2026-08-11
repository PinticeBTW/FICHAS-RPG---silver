import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchNetPulseNotificationPage,
  fetchNetPulseNotificationState,
  markAllNetPulseNotificationsRead,
  markNetPulseNotificationRead,
  type NetPulseNotification,
  type NetPulseNotificationCursor,
} from '../../lib/netPulseNotificationService'
import { isNetPulseContextChangedError } from '../../lib/netPulseRequestContext'

type NotificationState = {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly notifications: readonly NetPulseNotification[]
  readonly unreadCount: number | null
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly refreshing: boolean
  readonly reason?: string
}

const EMPTY_STATE: NotificationState = {
  status: 'idle',
  notifications: [],
  unreadCount: null,
  hasMore: false,
  loadingMore: false,
  refreshing: false,
}

const inFlightRequests = new Map<string, Promise<unknown>>()

function dedupe<T>(key: string, request: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key) as Promise<T> | undefined
  if (existing) return existing
  const pending = request().finally(() => {
    if (inFlightRequests.get(key) === pending) inFlightRequests.delete(key)
  })
  inFlightRequests.set(key, pending)
  return pending
}

function mergeNotifications(
  existing: readonly NetPulseNotification[],
  incoming: readonly NetPulseNotification[],
): readonly NetPulseNotification[] {
  return [...new Map([...existing, ...incoming].map((notification) => [notification.id, notification])).values()]
}

export function useNetPulseNotifications(input: {
  readonly viewerAccountId: string | null
  readonly open: boolean
  readonly notificationRevision: number
  readonly profileRevision: number
  readonly invalidatedPostId: string | null
  readonly onContextMismatch?: (error: Error) => void
}) {
  const {
    viewerAccountId,
    open,
    notificationRevision,
    profileRevision,
    invalidatedPostId,
    onContextMismatch,
  } = input
  const [state, setState] = useState<NotificationState>(EMPTY_STATE)
  const viewerRef = useRef(viewerAccountId)
  const stateRef = useRef(state)
  const cursorRef = useRef<NetPulseNotificationCursor | null>(null)
  const requestSequenceRef = useRef(0)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  viewerRef.current = viewerAccountId
  stateRef.current = state

  const loadUnread = useCallback(async (expectedViewer: string): Promise<void> => {
    const sequence = ++requestSequenceRef.current
    try {
      const notificationState = await dedupe(
        `notifications:${expectedViewer}:unread`,
        () => fetchNetPulseNotificationState(expectedViewer),
      )
      if (viewerRef.current !== expectedViewer || sequence !== requestSequenceRef.current) return
      setState((current) => ({ ...current, unreadCount: notificationState.unreadCount }))
    } catch (error) {
      if (viewerRef.current !== expectedViewer || sequence !== requestSequenceRef.current) return
      if (isNetPulseContextChangedError(error)) onContextMismatch?.(error)
      setState((current) => ({
        ...current,
        status: current.notifications.length ? 'error' : current.status,
        reason: error instanceof Error ? error.message : 'PULSE unread state is unavailable.',
      }))
    }
  }, [onContextMismatch])

  const loadFirstPage = useCallback(async (
    expectedViewer: string,
    preserveConfirmed: boolean,
  ): Promise<void> => {
    const sequence = ++requestSequenceRef.current
    setState((current) => ({
      ...current,
      status: preserveConfirmed && current.notifications.length ? 'ready' : 'loading',
      refreshing: preserveConfirmed && current.notifications.length > 0,
      loadingMore: false,
    }))
    try {
      const [page, notificationState] = await Promise.all([
        dedupe(`notifications:${expectedViewer}:first`, () => fetchNetPulseNotificationPage(expectedViewer)),
        dedupe(`notifications:${expectedViewer}:unread`, () => fetchNetPulseNotificationState(expectedViewer)),
      ])
      if (viewerRef.current !== expectedViewer || sequence !== requestSequenceRef.current) return
      cursorRef.current = page.nextCursor
      setState({
        status: 'ready',
        notifications: page.notifications,
        unreadCount: notificationState.unreadCount,
        hasMore: page.hasMore,
        loadingMore: false,
        refreshing: false,
      })
    } catch (error) {
      if (viewerRef.current !== expectedViewer || sequence !== requestSequenceRef.current) return
      if (isNetPulseContextChangedError(error)) onContextMismatch?.(error)
      setState((current) => ({
        ...current,
        status: 'error',
        refreshing: false,
        loadingMore: false,
        reason: error instanceof Error ? error.message : 'PULSE notifications are unavailable.',
      }))
    }
  }, [onContextMismatch])

  useEffect(() => {
    requestSequenceRef.current += 1
    cursorRef.current = null
    setState(EMPTY_STATE)
    if (!viewerAccountId) return
    void loadUnread(viewerAccountId)
  }, [loadUnread, viewerAccountId])

  useEffect(() => {
    if (!viewerAccountId || !open) return
    void loadFirstPage(viewerAccountId, stateRef.current.notifications.length > 0)
  }, [loadFirstPage, open, viewerAccountId])

  useEffect(() => {
    if (!viewerAccountId || notificationRevision <= 0) return undefined
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null
      if (viewerRef.current !== viewerAccountId) return
      if (open) void loadFirstPage(viewerAccountId, true)
      else void loadUnread(viewerAccountId)
    }, 500)
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [loadFirstPage, loadUnread, notificationRevision, open, viewerAccountId])

  useEffect(() => {
    if (!viewerAccountId || !open || profileRevision <= 0) return undefined
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null
      if (viewerRef.current === viewerAccountId) void loadFirstPage(viewerAccountId, true)
    }, 320)
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [loadFirstPage, open, profileRevision, viewerAccountId])

  useEffect(() => {
    if (!viewerAccountId || !invalidatedPostId) return
    const affectsVisibleInbox = stateRef.current.notifications.some(
      (notification) => notification.postId === invalidatedPostId
        || notification.rootPostId === invalidatedPostId,
    )
    if (!affectsVisibleInbox) return
    setState((current) => ({
      ...current,
      notifications: current.notifications.map((notification) => {
        if (notification.postId !== invalidatedPostId
          && notification.rootPostId !== invalidatedPostId) return notification
        const { postExcerpt: removedExcerpt, ...retained } = notification
        void removedExcerpt
        return { ...retained, postAvailable: false }
      }),
    }))
    if (open) void loadFirstPage(viewerAccountId, true)
  }, [invalidatedPostId, loadFirstPage, open, viewerAccountId])

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
  }, [])

  const loadMore = useCallback(async (): Promise<void> => {
    const expectedViewer = viewerRef.current
    const cursor = cursorRef.current
    if (!expectedViewer || !cursor || !stateRef.current.hasMore || stateRef.current.loadingMore) return
    setState((current) => ({ ...current, loadingMore: true }))
    try {
      const page = await dedupe(
        `notifications:${expectedViewer}:${cursor.createdAt}:${cursor.id}`,
        () => fetchNetPulseNotificationPage(expectedViewer, cursor),
      )
      if (viewerRef.current !== expectedViewer) return
      cursorRef.current = page.nextCursor
      setState((current) => ({
        ...current,
        status: 'ready',
        notifications: mergeNotifications(current.notifications, page.notifications),
        hasMore: page.hasMore,
        loadingMore: false,
        refreshing: false,
      }))
    } catch (error) {
      if (viewerRef.current !== expectedViewer) return
      if (isNetPulseContextChangedError(error)) onContextMismatch?.(error)
      setState((current) => ({
        ...current,
        status: 'error',
        loadingMore: false,
        reason: error instanceof Error ? error.message : 'More PULSE notifications could not be loaded.',
      }))
    }
  }, [onContextMismatch])

  const markRead = useCallback(async (notificationId: string): Promise<void> => {
    const expectedViewer = viewerRef.current
    if (!expectedViewer) throw new Error('A personal PULSE identity is required.')
    const target = stateRef.current.notifications.find((entry) => entry.id === notificationId)
    if (!target || target.readAt) return
    const readAt = new Date().toISOString()
    setState((current) => ({
      ...current,
      notifications: current.notifications.map((entry) => entry.id === notificationId
        ? { ...entry, readAt }
        : entry),
      unreadCount: current.unreadCount === null ? null : Math.max(0, current.unreadCount - 1),
    }))
    try {
      await markNetPulseNotificationRead(notificationId, expectedViewer)
    } catch (error) {
      if (viewerRef.current === expectedViewer) {
        setState((current) => ({
          ...current,
          notifications: current.notifications.map((entry) => entry.id === notificationId
            ? { ...entry, readAt: undefined }
            : entry),
          unreadCount: current.unreadCount === null ? null : current.unreadCount + 1,
        }))
      }
      if (isNetPulseContextChangedError(error)) onContextMismatch?.(error)
      throw error
    }
  }, [onContextMismatch])

  const markAllRead = useCallback(async (): Promise<void> => {
    const expectedViewer = viewerRef.current
    if (!expectedViewer) throw new Error('A personal PULSE identity is required.')
    const previous = stateRef.current
    const readAt = new Date().toISOString()
    setState((current) => ({
      ...current,
      notifications: current.notifications.map((entry) => entry.readAt ? entry : { ...entry, readAt }),
      unreadCount: 0,
    }))
    try {
      await markAllNetPulseNotificationsRead(expectedViewer)
    } catch (error) {
      if (viewerRef.current === expectedViewer) setState(previous)
      if (isNetPulseContextChangedError(error)) onContextMismatch?.(error)
      throw error
    }
  }, [onContextMismatch])

  const retry = useCallback(() => {
    const expectedViewer = viewerRef.current
    if (!expectedViewer) return
    if (open) void loadFirstPage(expectedViewer, stateRef.current.notifications.length > 0)
    else void loadUnread(expectedViewer)
  }, [loadFirstPage, loadUnread, open])

  return {
    state,
    loadMore,
    markRead,
    markAllRead,
    retry,
  }
}
