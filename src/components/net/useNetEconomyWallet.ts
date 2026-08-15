import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchNetEconomyWallet,
  transferNetEconomyWallet,
} from '../../lib/netEconomyService'
import {
  subscribeToNetEconomyWallet,
  type NetEconomyRealtimeStatus,
} from '../../lib/netEconomyRealtimeService'
import type {
  NetEconomyActivity,
  NetEconomyBalance,
  NetEconomyCurrency,
  NetEconomyWalletIdentity,
  NetEconomyWalletPayload,
} from '../../lib/netEconomyTypes'

type PlayerWalletStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface NetEconomyWalletController {
  readonly status: PlayerWalletStatus
  readonly identity?: NetEconomyWalletIdentity
  readonly balances: readonly NetEconomyBalance[]
  readonly activity: readonly NetEconomyActivity[]
  readonly hasMore: boolean
  readonly refreshing: boolean
  readonly loadingMore: boolean
  readonly mutationPending: boolean
  readonly error?: string
  readonly realtimeStatus: NetEconomyRealtimeStatus
  readonly retry: () => Promise<void>
  readonly loadMore: () => Promise<void>
  readonly transfer: (input: {
    paymentIdentifier: string
    currency: NetEconomyCurrency
    amount: number
    note?: string
    requestKey: string
  }) => Promise<void>
}

function mergeActivities(
  first: readonly NetEconomyActivity[],
  second: readonly NetEconomyActivity[],
): readonly NetEconomyActivity[] {
  const byId = new Map<string, NetEconomyActivity>()
  for (const activity of [...first, ...second]) byId.set(activity.transactionId, activity)
  return [...byId.values()].sort((left, right) => {
    const timeOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    return timeOrder || right.transactionId.localeCompare(left.transactionId)
  })
}

export function useNetEconomyWallet(
  enabled: boolean,
  expectedIdentityLinkId: string | null,
  identitySessionKey: string | null,
): NetEconomyWalletController {
  const [status, setStatus] = useState<PlayerWalletStatus>('idle')
  const [payload, setPayload] = useState<NetEconomyWalletPayload | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [mutationPending, setMutationPending] = useState(false)
  const [error, setError] = useState<string>()
  const [realtimeStatus, setRealtimeStatus] = useState<NetEconomyRealtimeStatus>('idle')
  const requestGenerationRef = useRef(0)
  const realtimeTimerRef = useRef<number | null>(null)
  const suppressRealtimeUntilRef = useRef(0)
  const payloadRef = useRef<NetEconomyWalletPayload | null>(null)
  const hasConfirmedWallet = Boolean(payload?.balances.length)

  const applyPayload = useCallback((next: NetEconomyWalletPayload, append = false) => {
    setPayload((previous) => {
      const resolved = append && previous
        ? { ...next, activity: { ...next.activity, items: mergeActivities(previous.activity.items, next.activity.items) } }
        : next
      payloadRef.current = resolved
      return resolved
    })
    setStatus('ready')
    setError(undefined)
  }, [])

  const refresh = useCallback(async (background: boolean) => {
    const generation = ++requestGenerationRef.current
    if (background) setRefreshing(true)
    else {
      setStatus('loading')
      setError(undefined)
    }
    try {
      if (!expectedIdentityLinkId) throw new Error('The VLT runtime identity is unavailable.')
      const next = await fetchNetEconomyWallet(expectedIdentityLinkId)
      if (generation !== requestGenerationRef.current) return
      applyPayload(next)
    } catch (caught) {
      if (generation !== requestGenerationRef.current) return
      setError(caught instanceof Error ? caught.message : 'Unable to load VLT.')
      if (!payloadRef.current) setStatus('error')
    } finally {
      if (generation === requestGenerationRef.current) setRefreshing(false)
    }
  }, [applyPayload, expectedIdentityLinkId])

  useEffect(() => {
    if (!enabled) {
      requestGenerationRef.current += 1
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      setStatus('idle')
      setPayload(null)
      payloadRef.current = null
      setError(undefined)
      setRealtimeStatus('idle')
      return
    }
    void refresh(false)
    return () => { requestGenerationRef.current += 1 }
  }, [enabled, identitySessionKey, refresh])

  useEffect(() => {
    if (!enabled || !hasConfirmedWallet) return
    const unsubscribe = subscribeToNetEconomyWallet(
      (accountId) => {
        const currentBalances = payloadRef.current?.balances ?? []
        if (!currentBalances.some((balance) => balance.accountId === accountId)) return
        if (Date.now() < suppressRealtimeUntilRef.current) return
        if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
        realtimeTimerRef.current = window.setTimeout(() => {
          realtimeTimerRef.current = null
          void refresh(true)
        }, 450)
      },
      setRealtimeStatus,
    )
    return () => {
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = null
      unsubscribe()
    }
  }, [enabled, hasConfirmedWallet, refresh])

  const loadMore = useCallback(async () => {
    const cursor = payload?.activity.nextCursor
    if (!cursor || loadingMore) return
    const generation = requestGenerationRef.current
    setLoadingMore(true)
    setError(undefined)
    try {
      if (!expectedIdentityLinkId) throw new Error('The VLT runtime identity is unavailable.')
      const next = await fetchNetEconomyWallet(expectedIdentityLinkId, cursor)
      if (generation !== requestGenerationRef.current) return
      applyPayload(next, true)
    } catch (caught) {
      if (generation === requestGenerationRef.current) {
        setError(caught instanceof Error ? caught.message : 'Unable to load more activity.')
      }
    } finally {
      if (generation === requestGenerationRef.current) setLoadingMore(false)
    }
  }, [applyPayload, expectedIdentityLinkId, loadingMore, payload?.activity.nextCursor])

  const transfer = useCallback(async (input: {
    paymentIdentifier: string
    currency: NetEconomyCurrency
    amount: number
    note?: string
    requestKey: string
  }) => {
    if (mutationPending) return
    setMutationPending(true)
    setError(undefined)
    try {
      if (!expectedIdentityLinkId) throw new Error('The VLT runtime identity is unavailable.')
      const next = await transferNetEconomyWallet({
        ...input,
        expectedIdentityLinkId,
      })
      suppressRealtimeUntilRef.current = Date.now() + 1200
      applyPayload(next)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Payment failed.'
      setError(message)
      throw caught
    } finally {
      setMutationPending(false)
    }
  }, [applyPayload, expectedIdentityLinkId, mutationPending])

  return {
    status,
    ...(payload ? { identity: payload.identity } : {}),
    balances: payload?.balances ?? [],
    activity: payload?.activity.items ?? [],
    hasMore: payload?.activity.hasMore ?? false,
    refreshing,
    loadingMore,
    mutationPending,
    ...(error ? { error } : {}),
    realtimeStatus,
    retry: () => refresh(Boolean(payload)),
    loadMore,
    transfer,
  }
}
