import { useCallback, useEffect, useRef, useState } from 'react'

import {
  appendNetNvnGmIncidentUpdate,
  createNetNvnGmIncident,
  fetchNetNvnGmIncident,
  fetchNetNvnGmIncidentDirectory,
  setNetNvnGmIncidentLifecycle,
  updateNetNvnGmIncident,
} from '../../lib/netNvnLiveService'
import type {
  NetNvnGmIncidentDetail,
  NetNvnGmIncidentDirectoryRow,
  NetNvnGmIncidentInput,
  NetNvnGmIncidentUpdateInput,
  NetNvnIncidentLifecycleAction,
} from '../../lib/netNvnLiveTypes'

type LoadPhase = 'idle' | 'loading' | 'ready' | 'refreshing' | 'failed'

function rowFromDetail(detail: NetNvnGmIncidentDetail): NetNvnGmIncidentDirectoryRow {
  return {
    id: detail.id,
    status: detail.status,
    headline: detail.headline,
    category: detail.category,
    verificationStatus: detail.verificationStatus,
    bylineName: detail.bylineName,
    updatedAt: detail.updatedAt,
    ...(detail.startedAt ? { startedAt: detail.startedAt } : {}),
    ...(detail.closedAt ? { closedAt: detail.closedAt } : {}),
    ...(detail.archivedAt ? { archivedAt: detail.archivedAt } : {}),
    updateCount: detail.updates.length,
  }
}

function upsertDirectory(
  rows: readonly NetNvnGmIncidentDirectoryRow[],
  detail: NetNvnGmIncidentDetail,
) {
  const next = rows.filter((row) => row.id !== detail.id)
  next.push(rowFromDetail(detail))
  return next.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
}

export function useNetNvnGmLiveControl(enabled: boolean) {
  const [directory, setDirectory] = useState<readonly NetNvnGmIncidentDirectoryRow[]>([])
  const [directoryPhase, setDirectoryPhase] = useState<LoadPhase>('idle')
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [detail, setDetail] = useState<NetNvnGmIncidentDetail | null>(null)
  const [detailPhase, setDetailPhase] = useState<LoadPhase>('idle')
  const [detailError, setDetailError] = useState<string | null>(null)
  const [isMutating, setIsMutating] = useState(false)
  const directoryRequestRef = useRef<Promise<readonly NetNvnGmIncidentDirectoryRow[]> | null>(null)
  const selectionVersionRef = useRef(0)
  const selectedIncidentIdRef = useRef<string | null>(null)
  const detailRef = useRef<NetNvnGmIncidentDetail | null>(null)
  const wasEnabledRef = useRef(false)

  const loadDirectory = useCallback(async (refresh = false) => {
    setDirectoryPhase((phase) => refresh && phase === 'ready' ? 'refreshing' : 'loading')
    setDirectoryError(null)
    let request = directoryRequestRef.current
    if (!request) {
      request = fetchNetNvnGmIncidentDirectory('all')
      directoryRequestRef.current = request
    }
    try {
      const rows = await request
      setDirectory(rows)
      setDirectoryPhase('ready')
      return rows
    } catch {
      setDirectoryPhase((phase) => directory.length > 0 && phase === 'refreshing' ? 'ready' : 'failed')
      setDirectoryError('The authoritative LIVE directory could not be synchronized.')
      return null
    } finally {
      if (directoryRequestRef.current === request) directoryRequestRef.current = null
    }
  }, [directory.length])

  useEffect(() => {
    const opening = enabled && !wasEnabledRef.current
    wasEnabledRef.current = enabled
    if (opening) void loadDirectory(directoryPhase === 'ready')
  }, [directoryPhase, enabled, loadDirectory])

  const clearSelection = useCallback(() => {
    selectionVersionRef.current += 1
    selectedIncidentIdRef.current = null
    detailRef.current = null
    setSelectedIncidentId(null)
    setDetail(null)
    setDetailPhase('idle')
    setDetailError(null)
  }, [])

  const selectIncident = useCallback(async (incidentId: string) => {
    const version = ++selectionVersionRef.current
    selectedIncidentIdRef.current = incidentId
    setSelectedIncidentId(incidentId)
    setDetailPhase('loading')
    setDetailError(null)
    try {
      const loaded = await fetchNetNvnGmIncident(incidentId)
      if (version !== selectionVersionRef.current || selectedIncidentIdRef.current !== incidentId) {
        return null
      }
      if (!loaded) {
        detailRef.current = null
        setDetail(null)
        setDetailPhase('failed')
        setDetailError('This incident no longer exists in the authoritative newsroom.')
        return null
      }
      detailRef.current = loaded
      setDetail(loaded)
      setDetailPhase('ready')
      return loaded
    } catch {
      if (version !== selectionVersionRef.current) return null
      detailRef.current = null
      setDetail(null)
      setDetailPhase('failed')
      setDetailError('The selected LIVE incident could not be synchronized.')
      return null
    }
  }, [])

  const refreshSelectedIncident = useCallback(async () => {
    const incidentId = selectedIncidentIdRef.current
    if (!incidentId) return null
    const version = ++selectionVersionRef.current
    setDetailPhase(detailRef.current ? 'refreshing' : 'loading')
    setDetailError(null)
    try {
      const loaded = await fetchNetNvnGmIncident(incidentId)
      if (version !== selectionVersionRef.current || selectedIncidentIdRef.current !== incidentId) {
        return null
      }
      if (!loaded) {
        detailRef.current = null
        setDetail(null)
        setDetailPhase('failed')
        setDetailError('This incident no longer exists in the authoritative newsroom.')
        return null
      }
      detailRef.current = loaded
      setDetail(loaded)
      setDetailPhase('ready')
      return loaded
    } catch {
      if (version !== selectionVersionRef.current) return null
      if (detailRef.current) {
        setDetailPhase('ready')
        setDetailError('The incident changed, but its server state could not be refreshed.')
      } else {
        setDetailPhase('failed')
        setDetailError('The selected LIVE incident could not be synchronized.')
      }
      return null
    }
  }, [])

  const acceptDetail = useCallback((saved: NetNvnGmIncidentDetail) => {
    selectedIncidentIdRef.current = saved.id
    detailRef.current = saved
    setDirectory((rows) => upsertDirectory(rows, saved))
    setSelectedIncidentId(saved.id)
    setDetail(saved)
    setDetailPhase('ready')
    setDetailError(null)
    return saved
  }, [])

  const mutate = useCallback(async (operation: () => Promise<NetNvnGmIncidentDetail>) => {
    const version = selectionVersionRef.current
    const expectedId = selectedIncidentIdRef.current
    setIsMutating(true)
    try {
      const saved = await operation()
      if (version === selectionVersionRef.current && expectedId === selectedIncidentIdRef.current) {
        return acceptDetail(saved)
      }
      setDirectory((rows) => upsertDirectory(rows, saved))
      return saved
    } finally {
      setIsMutating(false)
    }
  }, [acceptDetail])

  return {
    directory,
    directoryPhase,
    directoryError,
    selectedIncidentId,
    detail,
    detailPhase,
    detailError,
    isMutating,
    loadDirectory,
    clearSelection,
    selectIncident,
    refreshSelectedIncident,
    createIncident: (input: NetNvnGmIncidentInput) =>
      mutate(() => createNetNvnGmIncident(input)),
    updateIncident: (incidentId: string, input: NetNvnGmIncidentInput) =>
      mutate(() => updateNetNvnGmIncident(incidentId, input)),
    setLifecycle: (incidentId: string, action: NetNvnIncidentLifecycleAction) =>
      mutate(() => setNetNvnGmIncidentLifecycle(incidentId, action)),
    appendUpdate: (incidentId: string, input: NetNvnGmIncidentUpdateInput) =>
      mutate(() => appendNetNvnGmIncidentUpdate(incidentId, input)),
  }
}
