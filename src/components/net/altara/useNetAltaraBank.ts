import { useCallback, useEffect, useRef, useState } from 'react'

import type { NetBankPayee } from '../../../lib/netBankPaymentTypes'
import {
  adjustNetAltaraBankGmAccount,
  fetchNetAltaraBank,
  fetchNetAltaraBankGmAccount,
  fetchNetAltaraBankGmDirectory,
  openNetAltaraBank,
  payNetAltaraBank,
  quoteNetAltaraBankPayment,
  searchNetAltaraBankPayees,
} from '../../../lib/netAltaraBankService'
import {
  NetAltaraBankError,
  type NetAltaraBankActivity,
  type NetAltaraBankGmDirectoryRow,
  type NetAltaraBankGmMutation,
  type NetAltaraBankMutation,
  type NetAltaraBankPayload,
  type NetAltaraBankQuote,
} from '../../../lib/netAltaraBankTypes'
import {
  subscribeToNetEconomyWallet,
  type NetEconomyRealtimeStatus,
} from '../../../lib/netEconomyRealtimeService'

export type NetAltaraBankStatus = 'idle' | 'loading' | 'ready' | 'error'

interface KeyedPayload {
  readonly contextKey: string
  readonly payload: NetAltaraBankPayload
}

interface KeyedError {
  readonly contextKey: string
  readonly message: string
}

export interface NetAltaraBankController {
  readonly status: NetAltaraBankStatus
  readonly payload: NetAltaraBankPayload | null
  readonly refreshing: boolean
  readonly loadingMore: boolean
  readonly mutation: NetAltaraBankMutation | null
  readonly error?: string
  readonly realtimeStatus: NetEconomyRealtimeStatus
  readonly retry: () => Promise<void>
  readonly loadMore: () => Promise<void>
  readonly openAccount: () => Promise<void>
  readonly searchPayees: (query: string) => Promise<readonly NetBankPayee[]>
  readonly quotePayment: (input: {
    paymentIdentifier: string
    amount: number
  }) => Promise<NetAltaraBankQuote>
  readonly pay: (input: {
    paymentIdentifier: string
    amount: number
    rateRevision?: string
    requestKey: string
  }) => Promise<void>
}

function mergeActivity(
  current: readonly NetAltaraBankActivity[],
  incoming: readonly NetAltaraBankActivity[],
): readonly NetAltaraBankActivity[] {
  const rows = new Map<string, NetAltaraBankActivity>()
  for (const item of [...current, ...incoming]) rows.set(item.transactionId, item)
  return [...rows.values()].sort((left, right) => {
    const order = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    return order || right.transactionId.localeCompare(left.transactionId)
  })
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * Personal ALTARA BANK controller for a normal player or an authoritative GM
 * TAKE CONTROL player. The expected identity is sent to every RPC and is also
 * the local cache boundary, so a late Adrian response cannot render for Ayin.
 */
export function useNetAltaraBank(
  enabled: boolean,
  identitySessionKey: string | null,
  expectedIdentityLinkId: string | null,
): NetAltaraBankController {
  const contextKey = enabled && identitySessionKey && expectedIdentityLinkId
    ? `${identitySessionKey}:${expectedIdentityLinkId}`
    : null
  const [status, setStatus] = useState<NetAltaraBankStatus>('idle')
  const [result, setResult] = useState<KeyedPayload | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [mutation, setMutation] = useState<NetAltaraBankMutation | null>(null)
  const [error, setError] = useState<KeyedError | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<NetEconomyRealtimeStatus>('idle')
  const contextRef = useRef<{ key: string; identityLinkId: string } | null>(null)
  const resultRef = useRef<KeyedPayload | null>(null)
  const requestGenerationRef = useRef(0)
  const mutationGenerationRef = useRef(0)
  const mutationRef = useRef<NetAltaraBankMutation | null>(null)
  const realtimeTimerRef = useRef<number | null>(null)
  const suppressRealtimeUntilRef = useRef(0)

  contextRef.current = contextKey && expectedIdentityLinkId
    ? { key: contextKey, identityLinkId: expectedIdentityLinkId }
    : null

  const applyPayload = useCallback((
    expectedContextKey: string,
    next: NetAltaraBankPayload,
    append = false,
  ) => {
    if (contextRef.current?.key !== expectedContextKey) return
    const previous = resultRef.current?.contextKey === expectedContextKey
      ? resultRef.current.payload
      : null
    const payload = append && previous
      ? {
          ...next,
          activity: {
            ...next.activity,
            items: mergeActivity(previous.activity.items, next.activity.items),
          },
        }
      : next
    const keyed = { contextKey: expectedContextKey, payload }
    resultRef.current = keyed
    setResult(keyed)
    setStatus('ready')
    setError(null)
  }, [])

  const refresh = useCallback(async (background: boolean) => {
    const context = contextRef.current
    if (!context) return
    const generation = ++requestGenerationRef.current
    if (background) setRefreshing(true)
    else {
      setStatus('loading')
      setError(null)
    }
    try {
      const next = await fetchNetAltaraBank(context.identityLinkId)
      if (generation !== requestGenerationRef.current || contextRef.current?.key !== context.key) return
      applyPayload(context.key, next)
    } catch (caught) {
      if (generation !== requestGenerationRef.current || contextRef.current?.key !== context.key) return
      setError({ contextKey: context.key, message: failureMessage(caught, 'Unable to load ALTARA BANK.') })
      if (resultRef.current?.contextKey !== context.key) setStatus('error')
    } finally {
      if (generation === requestGenerationRef.current && contextRef.current?.key === context.key) {
        setRefreshing(false)
      }
    }
  }, [applyPayload])

  useEffect(() => {
    requestGenerationRef.current += 1
    mutationGenerationRef.current += 1
    mutationRef.current = null
    setMutation(null)
    setRefreshing(false)
    setLoadingMore(false)
    if (!contextKey) {
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      resultRef.current = null
      setResult(null)
      setStatus('idle')
      setError(null)
      setRealtimeStatus('idle')
      return
    }
    setStatus('loading')
    setError(null)
    void refresh(false)
    return () => {
      requestGenerationRef.current += 1
      mutationGenerationRef.current += 1
      mutationRef.current = null
    }
  }, [contextKey, refresh])

  const activePayload = result?.contextKey === contextKey ? result.payload : null
  const bankAccountId = activePayload?.bank?.accountId

  useEffect(() => {
    if (!contextKey || !bankAccountId) return
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
    kind: NetAltaraBankMutation,
    operation: (identityLinkId: string) => Promise<NetAltaraBankPayload>,
  ) => {
    const context = contextRef.current
    if (!context) {
      throw new NetAltaraBankError(
        'identity-context-changed',
        'The ALTARA identity context is no longer active.',
      )
    }
    if (mutationRef.current) {
      throw new NetAltaraBankError(
        'invalid-request',
        'Another ALTARA BANK action is still being authorized.',
      )
    }
    const generation = ++mutationGenerationRef.current
    mutationRef.current = kind
    setMutation(kind)
    setError(null)
    try {
      const next = await operation(context.identityLinkId)
      if (generation !== mutationGenerationRef.current || contextRef.current?.key !== context.key) {
        throw new NetAltaraBankError(
          'identity-context-changed',
          'The ALTARA identity changed before the bank action could be reconciled.',
        )
      }
      suppressRealtimeUntilRef.current = Date.now() + 1200
      if (realtimeTimerRef.current !== null) {
        window.clearTimeout(realtimeTimerRef.current)
        realtimeTimerRef.current = null
      }
      applyPayload(context.key, next)
    } catch (caught) {
      if (generation !== mutationGenerationRef.current || contextRef.current?.key !== context.key) throw caught
      setError({ contextKey: context.key, message: failureMessage(caught, 'ALTARA BANK action failed.') })
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
    const cursor = current && context && current.contextKey === context.key
      ? current.payload.activity.nextCursor
      : undefined
    if (!context || !cursor || loadingMore) return
    const generation = requestGenerationRef.current
    setLoadingMore(true)
    try {
      const next = await fetchNetAltaraBank(context.identityLinkId, cursor)
      if (generation !== requestGenerationRef.current || contextRef.current?.key !== context.key) return
      applyPayload(context.key, next, true)
    } catch (caught) {
      if (generation === requestGenerationRef.current && contextRef.current?.key === context.key) {
        setError({ contextKey: context.key, message: failureMessage(caught, 'Unable to load older activity.') })
      }
    } finally {
      if (generation === requestGenerationRef.current && contextRef.current?.key === context.key) {
        setLoadingMore(false)
      }
    }
  }, [applyPayload, loadingMore])

  const searchPayees = useCallback(async (query: string) => {
    const context = contextRef.current
    if (!context) {
      throw new NetAltaraBankError('identity-context-changed', 'The ALTARA identity context is no longer active.')
    }
    const results = await searchNetAltaraBankPayees(context.identityLinkId, query)
    if (contextRef.current?.key !== context.key) {
      throw new NetAltaraBankError('identity-context-changed', 'The ALTARA identity changed during directory search.')
    }
    return results
  }, [])

  const quotePayment = useCallback(async (input: {
    paymentIdentifier: string
    amount: number
  }) => {
    const context = contextRef.current
    if (!context) {
      throw new NetAltaraBankError('identity-context-changed', 'The ALTARA identity context is no longer active.')
    }
    const quote = await quoteNetAltaraBankPayment({
      expectedIdentityLinkId: context.identityLinkId,
      ...input,
    })
    if (contextRef.current?.key !== context.key) {
      throw new NetAltaraBankError('identity-context-changed', 'The ALTARA identity changed during payment review.')
    }
    return quote
  }, [])

  const activeError = error?.contextKey === contextKey ? error.message : undefined
  const activeStatus: NetAltaraBankStatus = !contextKey
    ? 'idle'
    : activePayload
      ? status === 'error' ? 'ready' : status
      : status === 'error'
        ? 'error'
        : 'loading'

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
    openAccount: () => runMutation('open', openNetAltaraBank),
    searchPayees,
    quotePayment,
    pay: (input) => runMutation('payment', (identityLinkId) => payNetAltaraBank({
      expectedIdentityLinkId: identityLinkId,
      ...input,
    })),
  }
}

export type NetAltaraBankGmDetailStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface NetAltaraBankGmController {
  readonly status: NetAltaraBankStatus
  readonly directory: readonly NetAltaraBankGmDirectoryRow[]
  readonly selectedPaymentIdentifier?: string
  readonly selected: NetAltaraBankPayload | null
  readonly detailStatus: NetAltaraBankGmDetailStatus
  readonly refreshing: boolean
  readonly loadingMore: boolean
  readonly mutation: NetAltaraBankGmMutation | null
  readonly error?: string
  readonly detailError?: string
  readonly realtimeStatus: NetEconomyRealtimeStatus
  readonly search: (query: string) => Promise<void>
  readonly select: (paymentIdentifier: string | null) => void
  readonly retryDirectory: () => Promise<void>
  readonly retrySelected: () => Promise<void>
  readonly loadMore: () => Promise<void>
  readonly adjust: (input: {
    action: NetAltaraBankGmMutation
    amount: number
    reason: string
    requestKey: string
  }) => Promise<void>
}

interface KeyedGmDetail {
  readonly sessionKey: string
  readonly paymentIdentifier: string
  readonly payload: NetAltaraBankPayload
}

/** GM-only administration data controller. It never calls personal-bank RPCs. */
export function useNetAltaraBankGm(
  enabled: boolean,
  identitySessionKey: string | null,
): NetAltaraBankGmController {
  const sessionKey = enabled && identitySessionKey ? identitySessionKey : null
  const [status, setStatus] = useState<NetAltaraBankStatus>('idle')
  const [directory, setDirectory] = useState<readonly NetAltaraBankGmDirectoryRow[]>([])
  const [selectedPaymentIdentifier, setSelectedPaymentIdentifier] = useState<string>()
  const [detail, setDetail] = useState<KeyedGmDetail | null>(null)
  const [detailStatus, setDetailStatus] = useState<NetAltaraBankGmDetailStatus>('idle')
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [mutation, setMutation] = useState<NetAltaraBankGmMutation | null>(null)
  const [error, setError] = useState<string>()
  const [detailError, setDetailError] = useState<string>()
  const [realtimeStatus, setRealtimeStatus] = useState<NetEconomyRealtimeStatus>('idle')
  const sessionKeyRef = useRef(sessionKey)
  const queryRef = useRef('')
  const directoryGenerationRef = useRef(0)
  const detailGenerationRef = useRef(0)
  const mutationGenerationRef = useRef(0)
  const mutationRef = useRef<NetAltaraBankGmMutation | null>(null)
  const detailRef = useRef<KeyedGmDetail | null>(null)
  const realtimeTimerRef = useRef<number | null>(null)
  const suppressRealtimeUntilRef = useRef(0)

  sessionKeyRef.current = sessionKey

  const loadDirectory = useCallback(async (query: string, background = false) => {
    const expectedSessionKey = sessionKeyRef.current
    if (!expectedSessionKey) return
    const generation = ++directoryGenerationRef.current
    queryRef.current = query
    if (background) setRefreshing(true)
    else setStatus('loading')
    setError(undefined)
    try {
      const next = await fetchNetAltaraBankGmDirectory(query)
      if (generation !== directoryGenerationRef.current || sessionKeyRef.current !== expectedSessionKey) return
      setDirectory(next)
      setStatus('ready')
    } catch (caught) {
      if (generation !== directoryGenerationRef.current || sessionKeyRef.current !== expectedSessionKey) return
      setError(failureMessage(caught, 'Unable to load ALTARA BANK administration.'))
      setStatus('error')
    } finally {
      if (generation === directoryGenerationRef.current && sessionKeyRef.current === expectedSessionKey) {
        setRefreshing(false)
      }
    }
  }, [])

  const loadDetail = useCallback(async (
    paymentId: string,
    cursor?: NetAltaraBankPayload['activity']['nextCursor'],
  ) => {
    const expectedSessionKey = sessionKeyRef.current
    if (!expectedSessionKey) return
    const generation = ++detailGenerationRef.current
    if (!cursor) {
      setDetailStatus('loading')
      setDetailError(undefined)
    } else setLoadingMore(true)
    try {
      const next = await fetchNetAltaraBankGmAccount(paymentId, cursor)
      if (
        generation !== detailGenerationRef.current
        || sessionKeyRef.current !== expectedSessionKey
        || selectedPaymentIdentifier !== paymentId
      ) return
      const previous = detailRef.current?.sessionKey === expectedSessionKey
        && detailRef.current.paymentIdentifier === paymentId
        ? detailRef.current.payload
        : null
      const payload = cursor && previous
        ? {
            ...next,
            activity: {
              ...next.activity,
              items: mergeActivity(previous.activity.items, next.activity.items),
            },
          }
        : next
      const keyed = { sessionKey: expectedSessionKey, paymentIdentifier: paymentId, payload }
      detailRef.current = keyed
      setDetail(keyed)
      setDetailStatus('ready')
      setDetailError(undefined)
    } catch (caught) {
      if (generation !== detailGenerationRef.current || sessionKeyRef.current !== expectedSessionKey) return
      setDetailError(failureMessage(caught, 'Unable to load the ALTARA BANK customer.'))
      if (!detailRef.current || detailRef.current.paymentIdentifier !== paymentId) setDetailStatus('error')
    } finally {
      if (generation === detailGenerationRef.current && sessionKeyRef.current === expectedSessionKey) {
        setLoadingMore(false)
      }
    }
  }, [selectedPaymentIdentifier])

  useEffect(() => {
    directoryGenerationRef.current += 1
    detailGenerationRef.current += 1
    mutationGenerationRef.current += 1
    mutationRef.current = null
    setMutation(null)
    setSelectedPaymentIdentifier(undefined)
    detailRef.current = null
    setDetail(null)
    setDetailStatus('idle')
    setDetailError(undefined)
    setLoadingMore(false)
    if (!sessionKey) {
      setStatus('idle')
      setDirectory([])
      setError(undefined)
      setRealtimeStatus('idle')
      return
    }
    void loadDirectory('')
    return () => {
      directoryGenerationRef.current += 1
      detailGenerationRef.current += 1
      mutationGenerationRef.current += 1
      mutationRef.current = null
    }
  }, [loadDirectory, sessionKey])

  useEffect(() => {
    detailGenerationRef.current += 1
    detailRef.current = null
    setDetail(null)
    setDetailError(undefined)
    if (!sessionKey || !selectedPaymentIdentifier) {
      setDetailStatus('idle')
      return
    }
    void loadDetail(selectedPaymentIdentifier)
  }, [loadDetail, selectedPaymentIdentifier, sessionKey])

  const selected = detail?.sessionKey === sessionKey
    && detail.paymentIdentifier === selectedPaymentIdentifier
    ? detail.payload
    : null
  const selectedAccountId = selected?.bank?.accountId

  useEffect(() => {
    if (!sessionKey || !selectedAccountId || !selectedPaymentIdentifier) return
    let lastStatus: NetEconomyRealtimeStatus = 'idle'
    const scheduleRefresh = (respectSuppression: boolean) => {
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = window.setTimeout(() => {
        realtimeTimerRef.current = null
        if (!respectSuppression || Date.now() >= suppressRealtimeUntilRef.current) {
          void loadDetail(selectedPaymentIdentifier)
        }
      }, 450)
    }
    const unsubscribe = subscribeToNetEconomyWallet((accountId) => {
      if (accountId !== selectedAccountId || Date.now() < suppressRealtimeUntilRef.current) return
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
  }, [loadDetail, selectedAccountId, selectedPaymentIdentifier, sessionKey])

  const adjust = useCallback(async (input: {
    action: NetAltaraBankGmMutation
    amount: number
    reason: string
    requestKey: string
  }) => {
    const expectedSessionKey = sessionKeyRef.current
    const paymentId = selectedPaymentIdentifier
    if (!expectedSessionKey || !paymentId) {
      throw new NetAltaraBankError(
        'identity-context-changed',
        'The ALTARA BANK administration context is no longer active.',
      )
    }
    if (mutationRef.current) {
      throw new NetAltaraBankError(
        'invalid-request',
        'Another ALTARA BANK adjustment is still being authorized.',
      )
    }
    const generation = ++mutationGenerationRef.current
    mutationRef.current = input.action
    setMutation(input.action)
    setDetailError(undefined)
    try {
      const next = await adjustNetAltaraBankGmAccount({
        paymentIdentifier: paymentId,
        ...input,
      })
      if (
        generation !== mutationGenerationRef.current
        || sessionKeyRef.current !== expectedSessionKey
        || selectedPaymentIdentifier !== paymentId
      ) {
        throw new NetAltaraBankError(
          'identity-context-changed',
          'The ALTARA BANK administration context changed before the adjustment could be reconciled.',
        )
      }
      suppressRealtimeUntilRef.current = Date.now() + 1200
      const keyed = { sessionKey: expectedSessionKey, paymentIdentifier: paymentId, payload: next }
      detailRef.current = keyed
      setDetail(keyed)
      setDetailStatus('ready')
      setDirectory((current) => current.map((row) => row.paymentIdentifier === paymentId && next.bank
        ? { ...row, balanceAmount: next.bank.balanceAmount, updatedAt: next.bank.updatedAt }
        : row))
    } catch (caught) {
      if (
        generation !== mutationGenerationRef.current
        || sessionKeyRef.current !== expectedSessionKey
        || selectedPaymentIdentifier !== paymentId
      ) throw caught
      setDetailError(failureMessage(caught, 'ALTARA BANK adjustment failed.'))
      throw caught
    } finally {
      if (generation === mutationGenerationRef.current && sessionKeyRef.current === expectedSessionKey) {
        mutationRef.current = null
        setMutation(null)
      }
    }
  }, [selectedPaymentIdentifier])

  return {
    status: sessionKey ? status : 'idle',
    directory: sessionKey ? directory : [],
    ...(sessionKey && selectedPaymentIdentifier ? { selectedPaymentIdentifier } : {}),
    selected,
    detailStatus: sessionKey ? detailStatus : 'idle',
    refreshing: Boolean(sessionKey && refreshing),
    loadingMore: Boolean(sessionKey && loadingMore),
    mutation: sessionKey ? mutation : null,
    ...(sessionKey && error ? { error } : {}),
    ...(sessionKey && detailError ? { detailError } : {}),
    realtimeStatus: sessionKey ? realtimeStatus : 'idle',
    search: (query) => loadDirectory(query),
    select: (paymentIdentifier) => setSelectedPaymentIdentifier(paymentIdentifier ?? undefined),
    retryDirectory: () => loadDirectory(queryRef.current, Boolean(directory.length)),
    retrySelected: () => selectedPaymentIdentifier ? loadDetail(selectedPaymentIdentifier) : Promise.resolve(),
    loadMore: () => selectedPaymentIdentifier && selected?.activity.nextCursor
      ? loadDetail(selectedPaymentIdentifier, selected.activity.nextCursor)
      : Promise.resolve(),
    adjust,
  }
}
