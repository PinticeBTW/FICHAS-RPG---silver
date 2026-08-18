import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchNetEchoMap,
  openNetEchoSignal,
  setNetEchoSignalSaved,
} from '../../lib/netEchoService'
import {
  isNetEchoContextChangedError,
  type NetEchoMapNode,
  type NetEchoMapProjection,
  type NetEchoSignalDetail,
} from '../../lib/netEchoTypes'

type EchoMapPhase = 'idle' | 'loading' | 'ready' | 'refreshing' | 'failed'
type EchoDetailPhase = 'idle' | 'loading' | 'ready' | 'unavailable' | 'failed'

interface EchoMapState {
  readonly accountId: string | null
  readonly phase: EchoMapPhase
  readonly projection: NetEchoMapProjection | null
  readonly error: string | null
}

interface EchoSelectionState {
  readonly accountId: string | null
  readonly signalId: string | null
}

interface EchoDetailState {
  readonly accountId: string | null
  readonly signalId: string | null
  readonly phase: EchoDetailPhase
  readonly detail: NetEchoSignalDetail | null
  readonly error: string | null
}

interface UseNetEchoBrowserInput {
  readonly accountId: string | null
  readonly enabled: boolean
  readonly onNotice: (message: string) => void
  readonly onContextChanged: () => void | Promise<void>
}

function mapLoadMessage(): string {
  return 'The resonance grid could not be synchronized. Check the connection and retry.'
}

function detailLoadMessage(): string {
  return 'This signal could not be synchronized. Retry when the grid is stable.'
}

function saveMessage(): string {
  return 'ECHO could not confirm that save state. The previous state has been restored.'
}

function patchProjectionNode(
  projection: NetEchoMapProjection,
  signalId: string,
  patch: Partial<Pick<NetEchoSignalDetail, 'viewerDiscovered' | 'viewerSaved'>>,
): NetEchoMapProjection {
  let changed = false
  const nodes = projection.nodes.map((node) => {
    if (node.id !== signalId || node.accessState !== 'visible') return node
    changed = true
    return { ...node, ...patch }
  })
  return changed ? { ...projection, nodes } : projection
}

/**
 * Small account-scoped ECHO runtime. It is deliberately not persistent or
 * authoritative: every map, detail, discovery and save value comes from 1A.
 */
export function useNetEchoBrowser({
  accountId,
  enabled,
  onNotice,
  onContextChanged,
}: UseNetEchoBrowserInput) {
  const [mapState, setMapState] = useState<EchoMapState>({
    accountId: null,
    phase: 'idle',
    projection: null,
    error: null,
  })
  const [selection, setSelection] = useState<EchoSelectionState>({
    accountId: null,
    signalId: null,
  })
  const [detailState, setDetailState] = useState<EchoDetailState>({
    accountId: null,
    signalId: null,
    phase: 'idle',
    detail: null,
    error: null,
  })
  const [savingSignalIds, setSavingSignalIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  const activeAccountIdRef = useRef<string | null>(accountId)
  const mapRequestRef = useRef<{
    readonly accountId: string
    readonly promise: Promise<NetEchoMapProjection>
  } | null>(null)
  const detailRequestsRef = useRef(new Map<string, Promise<NetEchoSignalDetail | null>>())
  const detailCacheRef = useRef(new Map<string, NetEchoSignalDetail>())
  const selectionRequestIdRef = useRef(0)

  activeAccountIdRef.current = accountId

  const handleContextChanged = useCallback((message: string) => {
    const staleAccountId = activeAccountIdRef.current
    selectionRequestIdRef.current += 1
    detailRequestsRef.current.clear()
    detailCacheRef.current.clear()
    setSavingSignalIds(new Set())
    setSelection({ accountId: staleAccountId, signalId: null })
    setDetailState({
      accountId: staleAccountId,
      signalId: null,
      phase: 'idle',
      detail: null,
      error: null,
    })
    setMapState({
      accountId: staleAccountId,
      phase: 'failed',
      projection: null,
      error: 'Character context changed. Synchronizing the active ECHO presence.',
    })
    onNotice(message)
    void onContextChanged()
  }, [onContextChanged, onNotice])

  const loadMap = useCallback(async (
    expectedAccountId: string,
    mode: 'initial' | 'background',
  ): Promise<NetEchoMapProjection | null> => {
    if (activeAccountIdRef.current !== expectedAccountId) return null

    setMapState((current) => {
      const confirmed = current.accountId === expectedAccountId
        ? current.projection
        : null
      return {
        accountId: expectedAccountId,
        phase: mode === 'background' && confirmed ? 'refreshing' : 'loading',
        projection: confirmed,
        error: null,
      }
    })

    let request = mapRequestRef.current
    if (!request || request.accountId !== expectedAccountId) {
      const promise = fetchNetEchoMap({ expectedAccountId })
      request = { accountId: expectedAccountId, promise }
      mapRequestRef.current = request
    }

    try {
      const projection = await request.promise
      if (activeAccountIdRef.current !== expectedAccountId) return null

      setMapState({
        accountId: expectedAccountId,
        phase: 'ready',
        projection,
        error: null,
      })

      setDetailState((current) => {
        if (
          current.accountId !== expectedAccountId
          || current.phase !== 'ready'
          || !current.detail
        ) return current
        const node = projection.nodes.find((entry) => entry.id === current.signalId)
        if (!node || node.accessState !== 'visible') return current
        const detail = { ...current.detail, viewerSaved: node.viewerSaved }
        detailCacheRef.current.set(detail.id, detail)
        return { ...current, detail }
      })

      return projection
    } catch (error) {
      if (activeAccountIdRef.current !== expectedAccountId) return null
      if (isNetEchoContextChangedError(error)) {
        handleContextChanged('ECHO // CHARACTER CHANGED BEFORE SYNCHRONIZATION COMPLETED')
        return null
      }

      setMapState((current) => ({
        accountId: expectedAccountId,
        phase: current.accountId === expectedAccountId && current.projection
          ? 'ready'
          : 'failed',
        projection: current.accountId === expectedAccountId
          ? current.projection
          : null,
        error: mapLoadMessage(),
      }))
      return null
    } finally {
      if (mapRequestRef.current?.promise === request.promise) {
        mapRequestRef.current = null
      }
    }
  }, [handleContextChanged])

  useEffect(() => {
    selectionRequestIdRef.current += 1
    detailRequestsRef.current.clear()
    detailCacheRef.current.clear()
    setSavingSignalIds(new Set())
    setSelection({ accountId, signalId: null })
    setDetailState({
      accountId,
      signalId: null,
      phase: 'idle',
      detail: null,
      error: null,
    })
    setMapState({
      accountId,
      phase: accountId ? 'idle' : 'idle',
      projection: null,
      error: null,
    })
  }, [accountId])

  useEffect(() => {
    if (!enabled || !accountId) return
    void loadMap(accountId, 'initial')
  }, [accountId, enabled, loadMap])

  const openSignal = useCallback(async (node: NetEchoMapNode) => {
    const expectedAccountId = activeAccountIdRef.current
    if (!expectedAccountId) return

    const requestId = ++selectionRequestIdRef.current
    setSelection({ accountId: expectedAccountId, signalId: node.id })

    if (node.accessState === 'locked') {
      setDetailState({
        accountId: expectedAccountId,
        signalId: node.id,
        phase: 'idle',
        detail: null,
        error: null,
      })
      return
    }

    const cached = detailCacheRef.current.get(node.id)
    if (cached) {
      setDetailState({
        accountId: expectedAccountId,
        signalId: node.id,
        phase: 'ready',
        detail: cached,
        error: null,
      })
      return
    }

    setDetailState({
      accountId: expectedAccountId,
      signalId: node.id,
      phase: 'loading',
      detail: null,
      error: null,
    })

    let request = detailRequestsRef.current.get(node.id)
    if (!request) {
      request = openNetEchoSignal(node.id, { expectedAccountId })
      detailRequestsRef.current.set(node.id, request)
    }

    try {
      const detail = await request
      if (activeAccountIdRef.current !== expectedAccountId) return

      if (!detail) {
        if (selectionRequestIdRef.current !== requestId) return
        setDetailState({
          accountId: expectedAccountId,
          signalId: node.id,
          phase: 'unavailable',
          detail: null,
          error: null,
        })
        return
      }

      detailCacheRef.current.set(node.id, detail)
      setMapState((current) => current.accountId === expectedAccountId && current.projection
        ? {
            ...current,
            projection: patchProjectionNode(current.projection, node.id, {
              viewerDiscovered: true,
              viewerSaved: detail.viewerSaved,
            }),
          }
        : current)

      if (!node.viewerDiscovered) {
        void loadMap(expectedAccountId, 'background')
      }
      if (selectionRequestIdRef.current !== requestId) return
      setDetailState({
        accountId: expectedAccountId,
        signalId: node.id,
        phase: 'ready',
        detail,
        error: null,
      })
    } catch (error) {
      if (
        activeAccountIdRef.current !== expectedAccountId
        || selectionRequestIdRef.current !== requestId
      ) return
      if (isNetEchoContextChangedError(error)) {
        handleContextChanged('ECHO // CHARACTER CHANGED BEFORE SIGNAL OPEN COMPLETED')
        return
      }
      setDetailState({
        accountId: expectedAccountId,
        signalId: node.id,
        phase: 'failed',
        detail: null,
        error: detailLoadMessage(),
      })
    } finally {
      if (detailRequestsRef.current.get(node.id) === request) {
        detailRequestsRef.current.delete(node.id)
      }
    }
  }, [handleContextChanged, loadMap])

  const retryDetail = useCallback((node: NetEchoMapNode | null) => {
    if (!node || node.accessState !== 'visible') return
    detailCacheRef.current.delete(node.id)
    void openSignal(node)
  }, [openSignal])

  const setSaved = useCallback(async (
    node: NetEchoMapNode,
    detail: NetEchoSignalDetail | null,
  ) => {
    const expectedAccountId = activeAccountIdRef.current
    if (!expectedAccountId || node.accessState !== 'visible') return
    if (savingSignalIds.has(node.id)) return

    const previousSaved = detail?.viewerSaved ?? node.viewerSaved
    const desiredSaved = !previousSaved
    setSavingSignalIds((current) => new Set(current).add(node.id))
    setMapState((current) => current.accountId === expectedAccountId && current.projection
      ? {
          ...current,
          projection: patchProjectionNode(current.projection, node.id, {
            viewerSaved: desiredSaved,
          }),
        }
      : current)
    setDetailState((current) => {
      if (
        current.accountId !== expectedAccountId
        || current.signalId !== node.id
        || !current.detail
      ) return current
      const nextDetail = { ...current.detail, viewerSaved: desiredSaved }
      detailCacheRef.current.set(node.id, nextDetail)
      return { ...current, detail: nextDetail }
    })

    try {
      const result = await setNetEchoSignalSaved({
        signalId: node.id,
        desiredSaved,
        context: { expectedAccountId },
      })
      if (activeAccountIdRef.current !== expectedAccountId) return

      setMapState((current) => current.accountId === expectedAccountId && current.projection
        ? {
            ...current,
            projection: patchProjectionNode(current.projection, node.id, {
              viewerSaved: result.viewerSaved,
            }),
          }
        : current)
      setDetailState((current) => {
        if (
          current.accountId !== expectedAccountId
          || current.signalId !== node.id
          || !current.detail
        ) return current
        const nextDetail = { ...current.detail, viewerSaved: result.viewerSaved }
        detailCacheRef.current.set(node.id, nextDetail)
        return { ...current, detail: nextDetail }
      })
      onNotice(result.viewerSaved
        ? `ECHO // SAVED ${node.title.toUpperCase()}`
        : `ECHO // REMOVED ${node.title.toUpperCase()} FROM SAVED`)
    } catch (error) {
      if (activeAccountIdRef.current !== expectedAccountId) return
      if (isNetEchoContextChangedError(error)) {
        handleContextChanged('ECHO // CHARACTER CHANGED BEFORE SAVE COMPLETED')
        return
      }

      setMapState((current) => current.accountId === expectedAccountId && current.projection
        ? {
            ...current,
            projection: patchProjectionNode(current.projection, node.id, {
              viewerSaved: previousSaved,
            }),
          }
        : current)
      setDetailState((current) => {
        if (
          current.accountId !== expectedAccountId
          || current.signalId !== node.id
          || !current.detail
        ) return current
        const nextDetail = { ...current.detail, viewerSaved: previousSaved }
        detailCacheRef.current.set(node.id, nextDetail)
        return { ...current, detail: nextDetail }
      })
      onNotice(`ECHO // ${saveMessage()}`)
    } finally {
      if (activeAccountIdRef.current === expectedAccountId) {
        setSavingSignalIds((current) => {
          const next = new Set(current)
          next.delete(node.id)
          return next
        })
      }
    }
  }, [handleContextChanged, onNotice, savingSignalIds])

  const activeMapState = mapState.accountId === accountId
    ? mapState
    : { accountId, phase: 'idle' as const, projection: null, error: null }
  const activeSelection = selection.accountId === accountId ? selection.signalId : null
  const activeDetailState = detailState.accountId === accountId
    ? detailState
    : {
        accountId,
        signalId: null,
        phase: 'idle' as const,
        detail: null,
        error: null,
      }

  return {
    projection: activeMapState.projection,
    mapPhase: activeMapState.phase,
    mapError: activeMapState.error,
    selectedSignalId: activeSelection,
    detailState: activeDetailState,
    savingSignalIds,
    openSignal,
    retryDetail,
    setSaved,
    retryMap: () => {
      if (accountId) void loadMap(accountId, activeMapState.projection ? 'background' : 'initial')
    },
  }
}
