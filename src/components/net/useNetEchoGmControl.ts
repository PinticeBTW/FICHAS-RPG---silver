import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createNetEchoGmSignal,
  fetchNetEchoGmGrantTargets,
  fetchNetEchoGmSignal,
  fetchNetEchoGmSignalDirectory,
  setNetEchoGmSignalGrant,
  setNetEchoGmSignalLifecycle,
  setNetEchoGmSignalLink,
  updateNetEchoGmSignal,
} from '../../lib/netEchoGmService'
import type {
  NetEchoGmGrantTarget,
  NetEchoGmSignalDetail,
  NetEchoGmSignalDirectoryRow,
  NetEchoGmSignalInput,
  NetEchoRelationshipKind,
  NetEchoSignalStatus,
} from '../../lib/netEchoTypes'

type LoadPhase = 'idle' | 'loading' | 'ready' | 'refreshing' | 'failed'

function directoryRowFromDetail(detail: NetEchoGmSignalDetail): NetEchoGmSignalDirectoryRow {
  return {
    id: detail.id,
    title: detail.title,
    kind: detail.kind,
    status: detail.status,
    visibilityMode: detail.visibilityMode,
    reliability: detail.reliability,
    intensity: detail.intensity,
    mapX: detail.mapX,
    mapY: detail.mapY,
    ...(detail.lockedTeaser ? { lockedTeaser: detail.lockedTeaser } : {}),
    linkCount: detail.links.length,
    requiresCount: detail.links.filter((link) =>
      link.fromSignalId === detail.id && link.relationshipKind === 'requires').length,
    updatedAt: detail.updatedAt,
    ...(detail.revealedAt ? { revealedAt: detail.revealedAt } : {}),
  }
}

function upsertDirectoryRow(
  rows: readonly NetEchoGmSignalDirectoryRow[],
  detail: NetEchoGmSignalDetail,
): readonly NetEchoGmSignalDirectoryRow[] {
  const next = rows.filter((row) => row.id !== detail.id)
  next.push(directoryRowFromDetail(detail))
  return next.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
}

export function useNetEchoGmControl(enabled: boolean) {
  const [directory, setDirectory] = useState<readonly NetEchoGmSignalDirectoryRow[]>([])
  const [directoryPhase, setDirectoryPhase] = useState<LoadPhase>('idle')
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null)
  const [detail, setDetail] = useState<NetEchoGmSignalDetail | null>(null)
  const [detailPhase, setDetailPhase] = useState<LoadPhase>('idle')
  const [detailError, setDetailError] = useState<string | null>(null)
  const [grantTargets, setGrantTargets] = useState<readonly NetEchoGmGrantTarget[]>([])
  const [grantPhase, setGrantPhase] = useState<LoadPhase>('idle')
  const [grantError, setGrantError] = useState<string | null>(null)
  const [isMutating, setIsMutating] = useState(false)

  const directoryRequestRef = useRef<Promise<readonly NetEchoGmSignalDirectoryRow[]> | null>(null)
  const detailRequestRef = useRef<{ id: string; promise: Promise<NetEchoGmSignalDetail | null> } | null>(null)
  const grantRequestRef = useRef<{ id: string; promise: Promise<readonly NetEchoGmGrantTarget[]> } | null>(null)
  const selectionVersionRef = useRef(0)
  const detailCacheRef = useRef(new Map<string, NetEchoGmSignalDetail>())

  const loadDirectory = useCallback(async (refresh = false) => {
    setDirectoryPhase((phase) => refresh && phase === 'ready' ? 'refreshing' : 'loading')
    setDirectoryError(null)
    let request = directoryRequestRef.current
    if (!request) {
      request = fetchNetEchoGmSignalDirectory()
      directoryRequestRef.current = request
    }
    try {
      const rows = await request
      setDirectory(rows)
      setDirectoryPhase('ready')
    } catch {
      setDirectoryPhase((phase) => directory.length > 0 && phase === 'refreshing' ? 'ready' : 'failed')
      setDirectoryError('Signal directory could not be synchronized.')
    } finally {
      if (directoryRequestRef.current === request) directoryRequestRef.current = null
    }
  }, [directory.length])

  useEffect(() => {
    if (!enabled || directoryPhase !== 'idle') return
    void loadDirectory()
  }, [directoryPhase, enabled, loadDirectory])

  const clearSelection = useCallback(() => {
    selectionVersionRef.current += 1
    setSelectedSignalId(null)
    setDetail(null)
    setDetailPhase('idle')
    setDetailError(null)
    setGrantTargets([])
    setGrantPhase('idle')
    setGrantError(null)
  }, [])

  const selectSignal = useCallback(async (signalId: string): Promise<NetEchoGmSignalDetail | null> => {
    const version = ++selectionVersionRef.current
    setSelectedSignalId(signalId)
    setGrantTargets([])
    setGrantPhase('idle')
    setGrantError(null)
    const cached = detailCacheRef.current.get(signalId)
    if (cached) {
      setDetail(cached)
      setDetailPhase('ready')
      setDetailError(null)
      return cached
    }

    setDetail(null)
    setDetailPhase('loading')
    setDetailError(null)
    let request = detailRequestRef.current
    if (!request || request.id !== signalId) {
      request = { id: signalId, promise: fetchNetEchoGmSignal(signalId) }
      detailRequestRef.current = request
    }
    try {
      const result = await request.promise
      if (selectionVersionRef.current !== version) return null
      if (!result) {
        setDetail(null)
        setDetailPhase('failed')
        setDetailError('This signal is no longer available to the editor.')
        return null
      }
      detailCacheRef.current.set(signalId, result)
      setDetail(result)
      setDetailPhase('ready')
      return result
    } catch {
      if (selectionVersionRef.current !== version) return null
      setDetail(null)
      setDetailPhase('failed')
      setDetailError('Signal detail could not be synchronized.')
      return null
    } finally {
      if (detailRequestRef.current?.promise === request.promise) detailRequestRef.current = null
    }
  }, [])

  const acceptDetail = useCallback((saved: NetEchoGmSignalDetail) => {
    detailCacheRef.current.set(saved.id, saved)
    setDirectory((rows) => upsertDirectoryRow(rows, saved))
    setSelectedSignalId(saved.id)
    setDetail(saved)
    setDetailPhase('ready')
    setDetailError(null)
    return saved
  }, [])

  const mutate = useCallback(async (
    operation: () => Promise<NetEchoGmSignalDetail>,
  ): Promise<NetEchoGmSignalDetail> => {
    setIsMutating(true)
    try {
      return acceptDetail(await operation())
    } finally {
      setIsMutating(false)
    }
  }, [acceptDetail])

  const createSignal = useCallback(
    (input: NetEchoGmSignalInput) => mutate(() => createNetEchoGmSignal(input)),
    [mutate],
  )
  const updateSignal = useCallback(
    (signalId: string, input: NetEchoGmSignalInput) =>
      mutate(() => updateNetEchoGmSignal(signalId, input)),
    [mutate],
  )
  const setLifecycle = useCallback(
    (signalId: string, status: NetEchoSignalStatus) =>
      mutate(() => setNetEchoGmSignalLifecycle(signalId, status)),
    [mutate],
  )
  const setLink = useCallback((input: {
    readonly fromSignalId: string
    readonly toSignalId: string
    readonly relationshipKind: NetEchoRelationshipKind
    readonly label?: string
    readonly desiredLinked: boolean
  }) => mutate(() => setNetEchoGmSignalLink(input)), [mutate])

  const loadGrantTargets = useCallback(async (signalId: string) => {
    const version = selectionVersionRef.current
    setGrantPhase(grantTargets.length > 0 ? 'refreshing' : 'loading')
    setGrantError(null)
    let request = grantRequestRef.current
    if (!request || request.id !== signalId) {
      request = { id: signalId, promise: fetchNetEchoGmGrantTargets(signalId) }
      grantRequestRef.current = request
    }
    try {
      const rows = await request.promise
      if (selectionVersionRef.current !== version) return
      setGrantTargets(rows)
      setGrantPhase('ready')
    } catch {
      if (selectionVersionRef.current !== version) return
      setGrantPhase(grantTargets.length > 0 ? 'ready' : 'failed')
      setGrantError('Grant targets could not be synchronized.')
    } finally {
      if (grantRequestRef.current?.promise === request.promise) grantRequestRef.current = null
    }
  }, [grantTargets.length])

  const setGrant = useCallback(async (
    signalId: string,
    target: NetEchoGmGrantTarget,
    desiredGranted: boolean,
  ) => {
    setIsMutating(true)
    setGrantTargets((rows) => rows.map((row) =>
      row.accountId === target.accountId ? { ...row, granted: desiredGranted } : row))
    try {
      const result = await setNetEchoGmSignalGrant({
        signalId,
        accountId: target.accountId,
        desiredGranted,
      })
      setGrantTargets((rows) => rows.map((row) =>
        row.accountId === result.accountId ? { ...row, granted: result.granted } : row))
    } catch (error) {
      setGrantTargets((rows) => rows.map((row) =>
        row.accountId === target.accountId ? { ...row, granted: target.granted } : row))
      throw error
    } finally {
      setIsMutating(false)
    }
  }, [])

  return {
    directory,
    directoryPhase,
    directoryError,
    selectedSignalId,
    detail,
    detailPhase,
    detailError,
    grantTargets,
    grantPhase,
    grantError,
    isMutating,
    loadDirectory,
    clearSelection,
    selectSignal,
    createSignal,
    updateSignal,
    setLifecycle,
    setLink,
    loadGrantTargets,
    setGrant,
  }
}
