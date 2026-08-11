import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchNetPulseDiscoverAccounts,
  fetchNetPulseAccountSummary,
  fetchNetPulseRelationshipPage,
  searchNetPulseAccounts,
  type NetPulseAccountSummary,
  type NetPulseRelationshipCursor,
  type NetPulseRelationshipDirection,
} from '../../lib/netPulseEngagementService'
import { isNetPulseContextChangedError } from '../../lib/netPulseRequestContext'

type PulseAccountSummaryState =
  | { readonly status: 'idle'; readonly key: null }
  | { readonly status: 'loading'; readonly key: string }
  | { readonly status: 'ready'; readonly key: string; readonly summary: NetPulseAccountSummary | null }
  | { readonly status: 'error'; readonly key: string; readonly reason: string }

export function useNetPulseAccountSummary(
  accountId: string | null,
  authoritativeRevision: number,
  expectedViewerAccountId: string | null,
  onContextMismatch?: (error: Error) => void,
): PulseAccountSummaryState {
  const [state, setState] = useState<PulseAccountSummaryState>({ status: 'idle', key: null })

  useEffect(() => {
    if (!accountId) return
    const expectedAccountId = accountId
    let cancelled = false
    void fetchNetPulseAccountSummary(expectedAccountId, expectedViewerAccountId).then((summary) => {
      if (!cancelled) setState({ status: 'ready', key: expectedAccountId, summary })
    }).catch((error: unknown) => {
      if (!cancelled) setState({
        status: 'error',
        key: expectedAccountId,
        reason: error instanceof Error ? error.message : 'PULSE account summary could not be synchronized.',
      })
      if (!cancelled && isNetPulseContextChangedError(error)) onContextMismatch?.(error)
    })
    return () => { cancelled = true }
  }, [accountId, authoritativeRevision, expectedViewerAccountId, onContextMismatch])

  if (!accountId) return { status: 'idle', key: null }
  return state.key === accountId ? state : { status: 'loading', key: accountId }
}

type PulseAccountSearchState =
  | { readonly status: 'idle' | 'loading'; readonly key: string | null; readonly results: readonly NetPulseAccountSummary[] }
  | { readonly status: 'ready'; readonly key: string; readonly results: readonly NetPulseAccountSummary[] }
  | { readonly status: 'error'; readonly key: string; readonly results: readonly NetPulseAccountSummary[]; readonly reason: string }

export function useNetPulseAccountSearch(
  query: string,
  sessionKey: string | null,
  authoritativeRevision: number,
  expectedViewerAccountId: string | null,
  onContextMismatch?: (error: Error) => void,
): PulseAccountSearchState {
  const [state, setState] = useState<PulseAccountSearchState>({ status: 'idle', key: null, results: [] })
  const normalizedQuery = query.trim().replace(/^@/, '')
  const requestKey = sessionKey && normalizedQuery.length >= 2
    ? `${sessionKey}:${normalizedQuery}`
    : null

  useEffect(() => {
    if (!requestKey) return
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) setState((current) => ({
        status: 'loading',
        key: requestKey,
        results: current.key === requestKey ? current.results : [],
      }))
    })
    const timer = window.setTimeout(() => {
      void searchNetPulseAccounts(normalizedQuery, expectedViewerAccountId).then((results) => {
        if (!cancelled) setState({ status: 'ready', key: requestKey, results })
      }).catch((error: unknown) => {
        if (!cancelled) setState((current) => ({
          status: 'error',
          key: requestKey,
          results: current.key === requestKey ? current.results : [],
          reason: error instanceof Error ? error.message : 'PULSE account search could not be synchronized.',
        }))
        if (!cancelled && isNetPulseContextChangedError(error)) onContextMismatch?.(error)
      })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [authoritativeRevision, expectedViewerAccountId, normalizedQuery, onContextMismatch, requestKey])

  if (!requestKey) return { status: 'idle', key: null, results: [] }
  return state.key === requestKey
    ? state
    : { status: 'loading', key: requestKey, results: [] }
}

type PulseAccountListState =
  | { readonly status: 'idle'; readonly key: null; readonly results: readonly NetPulseAccountSummary[] }
  | { readonly status: 'loading' | 'refreshing'; readonly key: string; readonly results: readonly NetPulseAccountSummary[] }
  | { readonly status: 'ready'; readonly key: string; readonly results: readonly NetPulseAccountSummary[] }
  | { readonly status: 'error'; readonly key: string; readonly results: readonly NetPulseAccountSummary[]; readonly reason: string }

type PulseRelationshipAccountListState = PulseAccountListState & {
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => Promise<void>
}

function useNetPulseAccountList(
  requestKey: string | null,
  authoritativeRevision: number,
  loader: () => Promise<readonly NetPulseAccountSummary[]>,
  enabled = true,
  onContextMismatch?: (error: Error) => void,
): PulseAccountListState {
  const [state, setState] = useState<PulseAccountListState>({ status: 'idle', key: null, results: [] })

  useEffect(() => {
    if (!requestKey || !enabled) return
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) setState((current) => current.key === requestKey && current.results.length > 0
        ? { status: 'refreshing', key: requestKey, results: current.results }
        : { status: 'loading', key: requestKey, results: [] })
    })
    void loader().then((results) => {
      if (!cancelled) setState({ status: 'ready', key: requestKey, results })
    }).catch((error: unknown) => {
      if (!cancelled) setState((current) => ({
        status: 'error',
        key: requestKey,
        results: current.key === requestKey ? current.results : [],
        reason: error instanceof Error ? error.message : 'PULSE social graph could not be synchronized.',
      }))
      if (!cancelled && isNetPulseContextChangedError(error)) onContextMismatch?.(error)
    })
    return () => { cancelled = true }
  }, [authoritativeRevision, enabled, loader, onContextMismatch, requestKey])

  if (!requestKey) return { status: 'idle', key: null, results: [] }
  if (state.key === requestKey) return state
  return enabled
    ? { status: 'loading', key: requestKey, results: [] }
    : { status: 'idle', key: null, results: [] }
}

export function useNetPulseDiscoverAccounts(
  sessionKey: string | null,
  authoritativeRevision: number,
  enabled: boolean,
  expectedViewerAccountId: string | null,
  onContextMismatch?: (error: Error) => void,
): PulseAccountListState {
  const requestKey = sessionKey ? `discover:${sessionKey}` : null
  const loader = useCallback(
    () => fetchNetPulseDiscoverAccounts(expectedViewerAccountId),
    [expectedViewerAccountId],
  )
  return useNetPulseAccountList(
    requestKey,
    authoritativeRevision,
    loader,
    enabled,
    onContextMismatch,
  )
}

export function useNetPulseRelationshipAccounts(
  profileAccountId: string | null,
  direction: NetPulseRelationshipDirection | null,
  sessionKey: string | null,
  authoritativeRevision: number,
  expectedViewerAccountId: string | null,
  onContextMismatch?: (error: Error) => void,
): PulseRelationshipAccountListState {
  const requestKey = profileAccountId && direction && sessionKey
    ? `relationships:${sessionKey}:${profileAccountId}:${direction}`
    : null
  const [state, setState] = useState<PulseAccountListState>({ status: 'idle', key: null, results: [] })
  const [cursor, setCursor] = useState<NetPulseRelationshipCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestSequence = useRef(0)

  useEffect(() => {
    if (!requestKey || !profileAccountId || !direction) return
    const sequence = ++requestSequence.current
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) setState((current) => current.key === requestKey && current.results.length > 0
        ? { status: 'refreshing', key: requestKey, results: current.results }
        : { status: 'loading', key: requestKey, results: [] })
    })
    void fetchNetPulseRelationshipPage(
      profileAccountId,
      direction,
      expectedViewerAccountId,
    ).then((page) => {
      if (cancelled || sequence !== requestSequence.current) return
      setState({ status: 'ready', key: requestKey, results: page.accounts })
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    }).catch((error: unknown) => {
      if (cancelled || sequence !== requestSequence.current) return
      setState((current) => ({
        status: 'error',
        key: requestKey,
        results: current.key === requestKey ? current.results : [],
        reason: error instanceof Error ? error.message : 'PULSE social graph could not be synchronized.',
      }))
      if (!cancelled && isNetPulseContextChangedError(error)) onContextMismatch?.(error)
    })
    return () => { cancelled = true }
  }, [authoritativeRevision, direction, expectedViewerAccountId, onContextMismatch, profileAccountId, requestKey, requestSequence])

  const loadMore = useCallback(async () => {
    if (!requestKey || !profileAccountId || !direction || !cursor || !hasMore || loadingMore) return
    setLoadingMore(true)
    const sequence = requestSequence.current
    try {
      const page = await fetchNetPulseRelationshipPage(
        profileAccountId,
        direction,
        expectedViewerAccountId,
        cursor,
      )
      if (sequence !== requestSequence.current) return
      setState((current) => {
        const existing = current.key === requestKey ? current.results : []
        return {
          status: 'ready',
          key: requestKey,
          results: [...new Map([...existing, ...page.accounts].map((account) => [account.accountId, account])).values()],
        }
      })
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (error) {
      if (sequence !== requestSequence.current) return
      if (isNetPulseContextChangedError(error)) onContextMismatch?.(error)
      setState((current) => ({
        status: 'error',
        key: requestKey,
        results: current.key === requestKey ? current.results : [],
        reason: error instanceof Error ? error.message : 'More PULSE relationships could not be loaded.',
      }))
    } finally {
      if (sequence === requestSequence.current) setLoadingMore(false)
    }
  }, [cursor, direction, expectedViewerAccountId, hasMore, loadingMore, onContextMismatch, profileAccountId, requestKey, requestSequence])

  const visibleState = !requestKey
    ? { status: 'idle' as const, key: null, results: [] }
    : state.key === requestKey
      ? state
      : { status: 'loading' as const, key: requestKey, results: [] }
  const currentKey = state.key === requestKey
  return {
    ...visibleState,
    hasMore: currentKey ? hasMore : false,
    loadingMore: currentKey ? loadingMore : false,
    loadMore,
  }
}
