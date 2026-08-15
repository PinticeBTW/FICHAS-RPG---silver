import { useCallback, useEffect, useRef, useState } from 'react'

import {
  claimNetVoxBankYield,
  fetchNetVoxBank,
  openNetVoxBank,
  payNetVoxBank,
  searchNetVoxBankPayees,
  transferNetVoxBank,
} from '../../lib/netVoxBankService'
import {
  subscribeToNetEconomyWallet,
  type NetEconomyRealtimeStatus,
} from '../../lib/netEconomyRealtimeService'
import type {
  NetVoxBankActivity,
  NetVoxBankDirection,
  NetVoxBankMutation,
  NetVoxBankPayload,
} from '../../lib/netVoxBankTypes'
import type { NetBankPayee } from '../../lib/netBankPaymentTypes'

type NetVoxBankStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface NetVoxBankController {
  readonly status: NetVoxBankStatus
  readonly payload: NetVoxBankPayload | null
  readonly refreshing: boolean
  readonly loadingMore: boolean
  readonly mutation: NetVoxBankMutation | null
  readonly error?: string
  readonly realtimeStatus: NetEconomyRealtimeStatus
  readonly retry: () => Promise<void>
  readonly loadMore: () => Promise<void>
  readonly openAccount: () => Promise<void>
  readonly transfer: (input: { direction: NetVoxBankDirection; amount: number; requestKey: string }) => Promise<void>
  readonly claimYield: (requestKey: string) => Promise<void>
  readonly searchPayees: (query: string) => Promise<readonly NetBankPayee[]>
  readonly pay: (input: { paymentIdentifier: string; amount: number; requestKey: string }) => Promise<void>
}

function mergeActivity(
  current: readonly NetVoxBankActivity[],
  incoming: readonly NetVoxBankActivity[],
): readonly NetVoxBankActivity[] {
  const rows = new Map<string, NetVoxBankActivity>()
  for (const item of [...current, ...incoming]) rows.set(item.transactionId, item)
  return [...rows.values()].sort((left, right) => {
    const order = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    return order || right.transactionId.localeCompare(left.transactionId)
  })
}

export function useNetVoxBank(
  enabled: boolean,
  expectedIdentityLinkId: string | null,
  identitySessionKey: string | null,
): NetVoxBankController {
  const [status, setStatus] = useState<NetVoxBankStatus>('idle')
  const [payload, setPayload] = useState<NetVoxBankPayload | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [mutation, setMutation] = useState<NetVoxBankMutation | null>(null)
  const [error, setError] = useState<string>()
  const [realtimeStatus, setRealtimeStatus] = useState<NetEconomyRealtimeStatus>('idle')
  const generationRef = useRef(0)
  const realtimeTimerRef = useRef<number | null>(null)
  const suppressRealtimeUntilRef = useRef(0)
  const payloadRef = useRef<NetVoxBankPayload | null>(null)
  const mutationRef = useRef<NetVoxBankMutation | null>(null)
  const mutationGenerationRef = useRef(0)
  const walletAccountId = payload?.wallet.accountId
  const bankAccountId = payload?.bank?.accountId
  const hasPayload = Boolean(payload)

  const applyPayload = useCallback((next: NetVoxBankPayload, append = false) => {
    setPayload((previous) => {
      const resolved = append && previous
        ? {
            ...next,
            activity: {
              ...next.activity,
              items: mergeActivity(previous.activity.items, next.activity.items),
            },
          }
        : next
      payloadRef.current = resolved
      return resolved
    })
    setStatus('ready')
    setError(undefined)
  }, [])

  const refresh = useCallback(async (background: boolean) => {
    const generation = ++generationRef.current
    if (background) setRefreshing(true)
    else {
      setStatus('loading')
      setError(undefined)
    }
    try {
      if (!expectedIdentityLinkId) throw new Error('The VOX BANK runtime identity is unavailable.')
      const next = await fetchNetVoxBank(expectedIdentityLinkId)
      if (generation !== generationRef.current) return
      applyPayload(next)
    } catch (caught) {
      if (generation !== generationRef.current) return
      setError(caught instanceof Error ? caught.message : 'Unable to load VOX BANK.')
      if (!payloadRef.current) setStatus('error')
    } finally {
      if (generation === generationRef.current) setRefreshing(false)
    }
  }, [applyPayload, expectedIdentityLinkId])

  useEffect(() => {
    mutationGenerationRef.current += 1
    mutationRef.current = null
    setMutation(null)
    if (!enabled) {
      generationRef.current += 1
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      setStatus('idle')
      setPayload(null)
      payloadRef.current = null
      setError(undefined)
      setRealtimeStatus('idle')
      return
    }
    void refresh(false)
    return () => {
      generationRef.current += 1
      mutationGenerationRef.current += 1
      mutationRef.current = null
    }
  }, [enabled, identitySessionKey, refresh])

  useEffect(() => {
    if (!enabled || !hasPayload || !walletAccountId) return
    const ownedAccountIds = new Set([
      walletAccountId,
      ...(bankAccountId ? [bankAccountId] : []),
    ])
    const unsubscribe = subscribeToNetEconomyWallet(
      (accountId) => {
        if (!ownedAccountIds.has(accountId) || Date.now() < suppressRealtimeUntilRef.current) return
        if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
        realtimeTimerRef.current = window.setTimeout(() => {
          realtimeTimerRef.current = null
          if (Date.now() < suppressRealtimeUntilRef.current) return
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
  }, [bankAccountId, enabled, hasPayload, refresh, walletAccountId])

  const runMutation = useCallback(async (
    kind: NetVoxBankMutation,
    operation: () => Promise<NetVoxBankPayload>,
  ) => {
    if (mutationRef.current) return
    const generation = ++mutationGenerationRef.current
    mutationRef.current = kind
    setMutation(kind)
    setError(undefined)
    try {
      const next = await operation()
      if (generation !== mutationGenerationRef.current) return
      suppressRealtimeUntilRef.current = Date.now() + 1200
      if (realtimeTimerRef.current !== null) {
        window.clearTimeout(realtimeTimerRef.current)
        realtimeTimerRef.current = null
      }
      applyPayload(next)
    } catch (caught) {
      if (generation !== mutationGenerationRef.current) return
      setError(caught instanceof Error ? caught.message : 'VOX BANK action failed.')
      throw caught
    } finally {
      if (generation === mutationGenerationRef.current) {
        mutationRef.current = null
        setMutation(null)
      }
    }
  }, [applyPayload])

  const loadMore = useCallback(async () => {
    const cursor = payload?.activity.nextCursor
    if (!cursor || loadingMore) return
    const generation = generationRef.current
    setLoadingMore(true)
    setError(undefined)
    try {
      if (!expectedIdentityLinkId) throw new Error('The VOX BANK runtime identity is unavailable.')
      const next = await fetchNetVoxBank(expectedIdentityLinkId, cursor)
      if (generation !== generationRef.current) return
      applyPayload(next, true)
    } catch (caught) {
      if (generation === generationRef.current) {
        setError(caught instanceof Error ? caught.message : 'Unable to load older VOX BANK activity.')
      }
    } finally {
      if (generation === generationRef.current) setLoadingMore(false)
    }
  }, [applyPayload, expectedIdentityLinkId, loadingMore, payload?.activity.nextCursor])

  return {
    status,
    payload,
    refreshing,
    loadingMore,
    mutation,
    ...(error ? { error } : {}),
    realtimeStatus,
    retry: () => refresh(Boolean(payload)),
    loadMore,
    openAccount: () => runMutation('open', () => {
      if (!expectedIdentityLinkId) throw new Error('The VOX BANK runtime identity is unavailable.')
      return openNetVoxBank(expectedIdentityLinkId)
    }),
    transfer: (input) => runMutation(input.direction, () => {
      if (!expectedIdentityLinkId) throw new Error('The VOX BANK runtime identity is unavailable.')
      return transferNetVoxBank({ ...input, expectedIdentityLinkId })
    }),
    claimYield: (requestKey) => runMutation('yield', () => {
      if (!expectedIdentityLinkId) throw new Error('The VOX BANK runtime identity is unavailable.')
      return claimNetVoxBankYield(expectedIdentityLinkId, requestKey)
    }),
    searchPayees: (query) => expectedIdentityLinkId
      ? searchNetVoxBankPayees(expectedIdentityLinkId, query)
      : Promise.resolve([]),
    pay: (input) => runMutation('payment', () => {
      if (!expectedIdentityLinkId) throw new Error('The VOX BANK runtime identity is unavailable.')
      return payNetVoxBank({ ...input, expectedIdentityLinkId })
    }),
  }
}
