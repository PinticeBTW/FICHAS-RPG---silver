import { useCallback, useEffect, useRef, useState } from 'react'

import type { NetBankPayee } from '../../../lib/netBankPaymentTypes'
import {
  fetchNetNovaBank,
  openNetNovaBank,
  payNetNovaBank,
  quoteNetNovaBankPayment,
  searchNetNovaBankPayees,
} from '../../../lib/netNovaBankService'
import {
  NetNovaBankError,
  type NetNovaBankActivity,
  type NetNovaBankMutation,
  type NetNovaBankPayload,
  type NetNovaBankQuote,
} from '../../../lib/netNovaBankTypes'
import {
  subscribeToNetEconomyWallet,
  type NetEconomyRealtimeStatus,
} from '../../../lib/netEconomyRealtimeService'

export type NetNovaBankStatus = 'idle' | 'loading' | 'ready' | 'error'

interface KeyedPayload {
  readonly contextKey: string
  readonly payload: NetNovaBankPayload
}

export interface NetNovaBankController {
  readonly status: NetNovaBankStatus
  readonly payload: NetNovaBankPayload | null
  readonly refreshing: boolean
  readonly loadingMore: boolean
  readonly mutation: NetNovaBankMutation | null
  readonly error?: string
  readonly realtimeStatus: NetEconomyRealtimeStatus
  readonly retry: () => Promise<void>
  readonly loadMore: () => Promise<void>
  readonly openAccount: () => Promise<void>
  readonly searchPayees: (query: string) => Promise<readonly NetBankPayee[]>
  readonly quotePayment: (input: { paymentIdentifier: string; amount: number }) => Promise<NetNovaBankQuote>
  readonly pay: (input: { paymentIdentifier: string; amount: number; rateRevision?: string; note?: string; requestKey: string }) => Promise<void>
}

function mergeActivity(current: readonly NetNovaBankActivity[], incoming: readonly NetNovaBankActivity[]) {
  const rows = new Map<string, NetNovaBankActivity>()
  for (const item of [...current, ...incoming]) rows.set(item.transactionId, item)
  return [...rows.values()].sort((left, right) => {
    const order = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    return order || right.transactionId.localeCompare(left.transactionId)
  })
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function useNetNovaBank(
  enabled: boolean,
  identitySessionKey: string | null,
  expectedIdentityLinkId: string | null,
): NetNovaBankController {
  const contextKey = enabled && identitySessionKey && expectedIdentityLinkId
    ? `${identitySessionKey}:${expectedIdentityLinkId}`
    : null
  const [status, setStatus] = useState<NetNovaBankStatus>('idle')
  const [result, setResult] = useState<KeyedPayload | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [mutation, setMutation] = useState<NetNovaBankMutation | null>(null)
  const [error, setError] = useState<{ contextKey: string; message: string } | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<NetEconomyRealtimeStatus>('idle')
  const contextRef = useRef<{ key: string; identityLinkId: string } | null>(null)
  const resultRef = useRef<KeyedPayload | null>(null)
  const requestGenerationRef = useRef(0)
  const mutationGenerationRef = useRef(0)
  const mutationRef = useRef<NetNovaBankMutation | null>(null)
  const realtimeTimerRef = useRef<number | null>(null)
  const suppressRealtimeUntilRef = useRef(0)

  contextRef.current = contextKey && expectedIdentityLinkId
    ? { key: contextKey, identityLinkId: expectedIdentityLinkId }
    : null
  resultRef.current = result

  const applyPayload = useCallback((key: string, payload: NetNovaBankPayload, append = false) => {
    setResult((current) => {
      const next = append && current?.contextKey === key
        ? { ...payload, activity: { ...payload.activity, items: mergeActivity(current.payload.activity.items, payload.activity.items) } }
        : payload
      return { contextKey: key, payload: next }
    })
    setStatus('ready')
    setError(null)
  }, [])

  const refresh = useCallback(async (background = false) => {
    const context = contextRef.current
    if (!context) return
    const generation = ++requestGenerationRef.current
    if (background) setRefreshing(true)
    else setStatus('loading')
    setError(null)
    try {
      const payload = await fetchNetNovaBank(context.identityLinkId)
      if (generation !== requestGenerationRef.current || contextRef.current?.key !== context.key) return
      applyPayload(context.key, payload)
    } catch (caught) {
      if (generation !== requestGenerationRef.current || contextRef.current?.key !== context.key) return
      setError({ contextKey: context.key, message: message(caught, 'Unable to load NOVA BANK.') })
      setStatus(resultRef.current?.contextKey === context.key ? 'ready' : 'error')
    } finally {
      if (generation === requestGenerationRef.current && contextRef.current?.key === context.key) setRefreshing(false)
    }
  }, [applyPayload])

  useEffect(() => {
    requestGenerationRef.current += 1
    mutationGenerationRef.current += 1
    mutationRef.current = null
    if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
    realtimeTimerRef.current = null
    setRefreshing(false)
    setLoadingMore(false)
    setMutation(null)
    setError(null)
    setRealtimeStatus('idle')
    if (!contextKey) {
      setResult(null)
      setStatus('idle')
      return
    }
    setResult(null)
    void refresh(false)
  }, [contextKey, refresh])

  const activePayload = result?.contextKey === contextKey ? result.payload : null
  const bankAccountId = activePayload?.bank?.accountId

  useEffect(() => {
    if (!contextKey || !bankAccountId) return undefined
    let lastStatus: NetEconomyRealtimeStatus = 'idle'
    const scheduleRefresh = (respectSuppression: boolean) => {
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = window.setTimeout(() => {
        realtimeTimerRef.current = null
        if (!respectSuppression || Date.now() >= suppressRealtimeUntilRef.current) void refresh(true)
      }, 450)
    }
    const unsubscribe = subscribeToNetEconomyWallet((accountId) => {
      if (accountId !== bankAccountId || Date.now() < suppressRealtimeUntilRef.current) return
      scheduleRefresh(true)
    }, (nextStatus) => {
      setRealtimeStatus(nextStatus)
      if (nextStatus === 'subscribed' && lastStatus !== 'subscribed') scheduleRefresh(false)
      lastStatus = nextStatus
    })
    return () => {
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = null
      unsubscribe()
    }
  }, [bankAccountId, contextKey, refresh])

  const runMutation = useCallback(async (
    kind: NetNovaBankMutation,
    operation: (identityLinkId: string) => Promise<NetNovaBankPayload>,
  ) => {
    const context = contextRef.current
    if (!context) throw new NetNovaBankError('identity-context-changed', 'The NOVA identity context is no longer active.')
    if (mutationRef.current) throw new NetNovaBankError('invalid-request', 'Another NOVA BANK action is still being authorized.')
    const generation = ++mutationGenerationRef.current
    mutationRef.current = kind
    setMutation(kind)
    setError(null)
    try {
      const payload = await operation(context.identityLinkId)
      if (generation !== mutationGenerationRef.current || contextRef.current?.key !== context.key) {
        throw new NetNovaBankError('identity-context-changed', 'The ALTARA identity changed before the bank action completed.')
      }
      suppressRealtimeUntilRef.current = Date.now() + 1200
      applyPayload(context.key, payload)
    } catch (caught) {
      if (generation !== mutationGenerationRef.current || contextRef.current?.key !== context.key) throw caught
      setError({ contextKey: context.key, message: message(caught, 'NOVA BANK action failed.') })
      throw caught
    } finally {
      if (generation === mutationGenerationRef.current && contextRef.current?.key === context.key) {
        mutationRef.current = null
        setMutation(null)
      }
    }
  }, [applyPayload])

  const loadMore = useCallback(async () => {
    const context = contextRef.current
    const current = resultRef.current
    const cursor = current && current.contextKey === context?.key
      ? current.payload.activity.nextCursor
      : undefined
    if (!context || !cursor || loadingMore) return
    const generation = requestGenerationRef.current
    setLoadingMore(true)
    try {
      const payload = await fetchNetNovaBank(context.identityLinkId, cursor)
      if (generation !== requestGenerationRef.current || contextRef.current?.key !== context.key) return
      applyPayload(context.key, payload, true)
    } catch (caught) {
      if (generation === requestGenerationRef.current && contextRef.current?.key === context.key) setError({ contextKey: context.key, message: message(caught, 'Unable to load earlier activity.') })
    } finally {
      if (generation === requestGenerationRef.current && contextRef.current?.key === context.key) setLoadingMore(false)
    }
  }, [applyPayload, loadingMore])

  const searchPayees = useCallback(async (query: string) => {
    const context = contextRef.current
    if (!context) throw new NetNovaBankError('identity-context-changed', 'The NOVA identity context is no longer active.')
    const rows = await searchNetNovaBankPayees(context.identityLinkId, query)
    if (contextRef.current?.key !== context.key) throw new NetNovaBankError('identity-context-changed', 'The ALTARA identity changed during recipient search.')
    return rows
  }, [])

  const quotePayment = useCallback(async (input: { paymentIdentifier: string; amount: number }) => {
    const context = contextRef.current
    if (!context) throw new NetNovaBankError('identity-context-changed', 'The NOVA identity context is no longer active.')
    const quote = await quoteNetNovaBankPayment({ expectedIdentityLinkId: context.identityLinkId, ...input })
    if (contextRef.current?.key !== context.key) throw new NetNovaBankError('identity-context-changed', 'The ALTARA identity changed during payment review.')
    return quote
  }, [])

  const activeError = error?.contextKey === contextKey ? error.message : undefined
  const activeStatus: NetNovaBankStatus = !contextKey
    ? 'idle'
    : activePayload
      ? status === 'error' ? 'ready' : status
      : status === 'error' ? 'error' : 'loading'

  return {
    status: activeStatus,
    payload: activePayload,
    refreshing: Boolean(contextKey && refreshing),
    loadingMore: Boolean(contextKey && loadingMore),
    mutation: contextKey ? mutation : null,
    ...(activeError ? { error: activeError } : {}),
    realtimeStatus: contextKey ? realtimeStatus : 'idle',
    retry: () => refresh(Boolean(activePayload)),
    loadMore,
    openAccount: () => runMutation('open', openNetNovaBank),
    searchPayees,
    quotePayment,
    pay: (input) => runMutation('payment', (identityLinkId) => payNetNovaBank({ expectedIdentityLinkId: identityLinkId, ...input })),
  }
}
