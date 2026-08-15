import { useCallback, useEffect, useRef, useState } from 'react'

import type { NetBankPayee } from '../../lib/netBankPaymentTypes'
import { subscribeToNetEconomyWallet, type NetEconomyRealtimeStatus } from '../../lib/netEconomyRealtimeService'
import {
  fetchNetShneiderBank,
  openNetShneiderBank,
  payNetShneiderBank,
  searchNetShneiderBankPayees,
  transferNetShneiderBank,
} from '../../lib/netShneiderBankService'
import type {
  NetShneiderBankActivity,
  NetShneiderBankDirection,
  NetShneiderBankMutation,
  NetShneiderBankPayload,
} from '../../lib/netShneiderBankTypes'

type NetShneiderBankStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface NetShneiderBankController {
  readonly status: NetShneiderBankStatus
  readonly payload: NetShneiderBankPayload | null
  readonly refreshing: boolean
  readonly loadingMore: boolean
  readonly mutation: NetShneiderBankMutation | null
  readonly error?: string
  readonly realtimeStatus: NetEconomyRealtimeStatus
  readonly retry: () => Promise<void>
  readonly loadMore: () => Promise<void>
  readonly openAccount: () => Promise<void>
  readonly transfer: (input: { direction: NetShneiderBankDirection; amount: number; requestKey: string }) => Promise<void>
  readonly searchPayees: (query: string) => Promise<readonly NetBankPayee[]>
  readonly pay: (input: { paymentIdentifier: string; amount: number; requestKey: string }) => Promise<void>
}

function mergeActivity(current: readonly NetShneiderBankActivity[], incoming: readonly NetShneiderBankActivity[]) {
  const rows = new Map<string, NetShneiderBankActivity>()
  for (const item of [...current, ...incoming]) rows.set(item.transactionId, item)
  return [...rows.values()].sort((left, right) => {
    const order = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    return order || right.transactionId.localeCompare(left.transactionId)
  })
}

export function useNetShneiderBank(
  enabled: boolean,
  expectedIdentityLinkId: string | null,
  identitySessionKey: string | null,
): NetShneiderBankController {
  const [status, setStatus] = useState<NetShneiderBankStatus>('idle')
  const [payload, setPayload] = useState<NetShneiderBankPayload | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [mutation, setMutation] = useState<NetShneiderBankMutation | null>(null)
  const [error, setError] = useState<string>()
  const [realtimeStatus, setRealtimeStatus] = useState<NetEconomyRealtimeStatus>('idle')
  const payloadRef = useRef<NetShneiderBankPayload | null>(null)
  const generationRef = useRef(0)
  const mutationGenerationRef = useRef(0)
  const mutationRef = useRef<NetShneiderBankMutation | null>(null)
  const realtimeTimerRef = useRef<number | null>(null)
  const suppressRealtimeUntilRef = useRef(0)
  const walletAccountId = payload?.wallet.accountId
  const bankAccountId = payload?.bank?.accountId

  const applyPayload = useCallback((next: NetShneiderBankPayload, append = false) => {
    setPayload((previous) => {
      const resolved = append && previous
        ? { ...next, activity: { ...next.activity, items: mergeActivity(previous.activity.items, next.activity.items) } }
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
    else { setStatus('loading'); setError(undefined) }
    try {
      if (!expectedIdentityLinkId) throw new Error('The SHNEIDER BANK runtime identity is unavailable.')
      const next = await fetchNetShneiderBank(expectedIdentityLinkId)
      if (generation !== generationRef.current) return
      applyPayload(next)
    } catch (caught) {
      if (generation !== generationRef.current) return
      setError(caught instanceof Error ? caught.message : 'Unable to load SHNEIDER BANK.')
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
    return () => { generationRef.current += 1; mutationGenerationRef.current += 1; mutationRef.current = null }
  }, [enabled, identitySessionKey, refresh])

  useEffect(() => {
    if (!enabled || !walletAccountId) return
    const accountIds = new Set([walletAccountId, ...(bankAccountId ? [bankAccountId] : [])])
    const unsubscribe = subscribeToNetEconomyWallet((accountId) => {
      if (!accountIds.has(accountId) || Date.now() < suppressRealtimeUntilRef.current) return
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = window.setTimeout(() => {
        realtimeTimerRef.current = null
        if (Date.now() >= suppressRealtimeUntilRef.current) void refresh(true)
      }, 450)
    }, setRealtimeStatus)
    return () => {
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = null
      unsubscribe()
    }
  }, [bankAccountId, enabled, refresh, walletAccountId])

  const runMutation = useCallback(async (kind: NetShneiderBankMutation, operation: () => Promise<NetShneiderBankPayload>) => {
    if (mutationRef.current) return
    const generation = ++mutationGenerationRef.current
    mutationRef.current = kind
    setMutation(kind)
    setError(undefined)
    try {
      const next = await operation()
      if (generation !== mutationGenerationRef.current) return
      suppressRealtimeUntilRef.current = Date.now() + 1200
      if (realtimeTimerRef.current !== null) { window.clearTimeout(realtimeTimerRef.current); realtimeTimerRef.current = null }
      applyPayload(next)
    } catch (caught) {
      if (generation !== mutationGenerationRef.current) return
      setError(caught instanceof Error ? caught.message : 'SHNEIDER BANK action failed.')
      throw caught
    } finally {
      if (generation === mutationGenerationRef.current) { mutationRef.current = null; setMutation(null) }
    }
  }, [applyPayload])

  const loadMore = useCallback(async () => {
    const cursor = payload?.activity.nextCursor
    if (!cursor || loadingMore) return
    const generation = generationRef.current
    setLoadingMore(true)
    try {
      if (!expectedIdentityLinkId) throw new Error('The SHNEIDER BANK runtime identity is unavailable.')
      const next = await fetchNetShneiderBank(expectedIdentityLinkId, cursor)
      if (generation === generationRef.current) applyPayload(next, true)
    } catch (caught) {
      if (generation === generationRef.current) setError(caught instanceof Error ? caught.message : 'Unable to load older activity.')
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
      if (!expectedIdentityLinkId) throw new Error('The SHNEIDER BANK runtime identity is unavailable.')
      return openNetShneiderBank(expectedIdentityLinkId)
    }),
    transfer: (input) => runMutation(input.direction, () => {
      if (!expectedIdentityLinkId) throw new Error('The SHNEIDER BANK runtime identity is unavailable.')
      return transferNetShneiderBank({ ...input, expectedIdentityLinkId })
    }),
    searchPayees: (query) => expectedIdentityLinkId
      ? searchNetShneiderBankPayees(expectedIdentityLinkId, query)
      : Promise.resolve([]),
    pay: (input) => runMutation('payment', () => {
      if (!expectedIdentityLinkId) throw new Error('The SHNEIDER BANK runtime identity is unavailable.')
      return payNetShneiderBank({ ...input, expectedIdentityLinkId })
    }),
  }
}
