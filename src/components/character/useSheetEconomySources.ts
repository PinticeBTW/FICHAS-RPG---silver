import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchSheetEconomyAccountSources,
  SHEET_ECONOMY_AUTHORITY_CHANGED_EVENT,
  type SheetEconomyAccountSources,
  type SheetEconomySubjectKind,
} from '../../lib/sheetEconomyService'
import { subscribeToNetEconomyWallet } from '../../lib/netEconomyRealtimeService'

type SheetEconomySourceStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SheetEconomySourcesController {
  readonly status: SheetEconomySourceStatus
  readonly payload: SheetEconomyAccountSources | null
  readonly refreshing: boolean
  readonly error?: string
  readonly retry: () => Promise<void>
}

interface SheetEconomyResult {
  readonly subjectKey: string
  readonly payload: SheetEconomyAccountSources
}

export function useSheetEconomySources(
  subject: { subjectKind: SheetEconomySubjectKind; subjectId: string } | null,
  enabled: boolean,
): SheetEconomySourcesController {
  const [status, setStatus] = useState<SheetEconomySourceStatus>('idle')
  const [result, setResult] = useState<SheetEconomyResult | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string>()
  const resultRef = useRef<SheetEconomyResult | null>(null)
  const generationRef = useRef(0)
  const realtimeTimerRef = useRef<number | null>(null)
  const subjectKey = subject ? `${subject.subjectKind}:${subject.subjectId}` : ''

  const refresh = useCallback(async () => {
    if (!subject) return
    const generation = ++generationRef.current
    const hasStablePayload = resultRef.current?.subjectKey === subjectKey
    if (hasStablePayload) setRefreshing(true)
    else setStatus('loading')
    setError(undefined)
    try {
      const next = await fetchSheetEconomyAccountSources(subject)
      if (generation !== generationRef.current) return
      const nextResult = { subjectKey, payload: next }
      resultRef.current = nextResult
      setResult(nextResult)
      setStatus('ready')
    } catch (caught) {
      if (generation !== generationRef.current) return
      setError(caught instanceof Error ? caught.message : 'Unable to load sheet accounts.')
      setStatus(hasStablePayload ? 'ready' : 'error')
    } finally {
      if (generation === generationRef.current) setRefreshing(false)
    }
  }, [subject, subjectKey])

  useEffect(() => {
    generationRef.current += 1
    setRefreshing(false)
    if (!enabled || !subject) return

    const loadTimer = window.setTimeout(() => {
      void refresh()
    }, 0)
    return () => {
      window.clearTimeout(loadTimer)
      generationRef.current += 1
    }
  }, [enabled, refresh, subject, subjectKey])

  useEffect(() => {
    if (!enabled || !subject) return
    const reconcile = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', reconcile)
    window.addEventListener(SHEET_ECONOMY_AUTHORITY_CHANGED_EVENT, reconcile)
    document.addEventListener('visibilitychange', reconcile)
    return () => {
      window.removeEventListener('focus', reconcile)
      window.removeEventListener(SHEET_ECONOMY_AUTHORITY_CHANGED_EVENT, reconcile)
      document.removeEventListener('visibilitychange', reconcile)
    }
  }, [enabled, refresh, subject])

  const activePayload = result?.subjectKey === subjectKey ? result.payload : null
  const realtimeAccountKey = activePayload
    ? [
        activePayload.vlt?.accountId,
        activePayload.voxBank?.accountId,
        activePayload.shneiderBank?.accountId,
        activePayload.altaraBank?.accountId,
        activePayload.novaBank?.accountId,
      ].filter((accountId): accountId is string => Boolean(accountId)).sort().join(':')
    : ''

  useEffect(() => {
    if (!enabled || !realtimeAccountKey) return
    const accountIds = new Set(realtimeAccountKey.split(':'))
    if (!accountIds.size) return

    let lastRealtimeStatus = 'idle'
    const scheduleRefresh = () => {
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = window.setTimeout(() => {
        realtimeTimerRef.current = null
        void refresh()
      }, 450)
    }
    const unsubscribe = subscribeToNetEconomyWallet(
      (accountId) => {
        if (!accountIds.has(accountId)) return
        scheduleRefresh()
      },
      (nextStatus) => {
        if (nextStatus === 'subscribed' && lastRealtimeStatus !== 'subscribed') scheduleRefresh()
        lastRealtimeStatus = nextStatus
      },
    )

    return () => {
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = null
      unsubscribe()
    }
  }, [enabled, realtimeAccountKey, refresh, subjectKey])

  const activeStatus: SheetEconomySourceStatus = !enabled
    ? 'idle'
    : activePayload
      ? status
      : status === 'error'
        ? 'error'
        : 'loading'

  return {
    status: activeStatus,
    payload: activePayload,
    refreshing: Boolean(activePayload) && refreshing,
    ...(enabled && error ? { error } : {}),
    retry: refresh,
  }
}
