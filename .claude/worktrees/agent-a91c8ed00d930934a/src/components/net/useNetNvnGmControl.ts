import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createNetNvnGmArticle,
  fetchNetNvnGmArticle,
  fetchNetNvnGmArticleDirectory,
  removeNetNvnGmArticleMedia,
  setNetNvnGmArticleLifecycle,
  setNetNvnGmArticleMedia,
  updateNetNvnGmArticle,
} from '../../lib/netNvnGmService'
import type {
  NetNvnGmArticleDetail,
  NetNvnGmArticleDirectoryRow,
  NetNvnGmArticleInput,
  NetNvnGmArticleMediaInput,
  NetNvnGmLifecycleAction,
} from '../../lib/netNvnTypes'

type LoadPhase = 'idle' | 'loading' | 'ready' | 'refreshing' | 'failed'

function directoryRowFromDetail(detail: NetNvnGmArticleDetail): NetNvnGmArticleDirectoryRow {
  return {
    id: detail.id,
    slug: detail.slug,
    status: detail.status,
    storyKind: detail.storyKind,
    priority: detail.priority,
    category: detail.category,
    headline: detail.headline,
    ...(detail.shortHeadline ? { shortHeadline: detail.shortHeadline } : {}),
    bylineName: detail.bylineName,
    sourceStatus: detail.sourceStatus,
    updatedAt: detail.updatedAt,
    ...(detail.publishedAt ? { publishedAt: detail.publishedAt } : {}),
    ...(detail.archivedAt ? { archivedAt: detail.archivedAt } : {}),
  }
}

function upsertDirectoryRow(
  rows: readonly NetNvnGmArticleDirectoryRow[],
  detail: NetNvnGmArticleDetail,
): readonly NetNvnGmArticleDirectoryRow[] {
  const next = rows.filter((row) => row.id !== detail.id)
  next.push(directoryRowFromDetail(detail))
  return next.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
}

export function useNetNvnGmControl(enabled: boolean) {
  const [directory, setDirectory] = useState<readonly NetNvnGmArticleDirectoryRow[]>([])
  const [directoryPhase, setDirectoryPhase] = useState<LoadPhase>('idle')
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null)
  const [detail, setDetail] = useState<NetNvnGmArticleDetail | null>(null)
  const [detailPhase, setDetailPhase] = useState<LoadPhase>('idle')
  const [detailError, setDetailError] = useState<string | null>(null)
  const [isMutating, setIsMutating] = useState(false)

  const directoryRequestRef = useRef<Promise<readonly NetNvnGmArticleDirectoryRow[]> | null>(null)
  const detailRequestRef = useRef<{
    readonly id: string
    readonly promise: Promise<NetNvnGmArticleDetail | null>
  } | null>(null)
  const selectionVersionRef = useRef(0)
  const selectedArticleIdRef = useRef<string | null>(null)
  const detailRef = useRef<NetNvnGmArticleDetail | null>(null)
  const wasEnabledRef = useRef(false)
  const activeMutationCountRef = useRef(0)

  const loadDirectory = useCallback(async (refresh = false) => {
    setDirectoryPhase((phase) => refresh && phase === 'ready' ? 'refreshing' : 'loading')
    setDirectoryError(null)
    let request = directoryRequestRef.current
    if (!request) {
      request = fetchNetNvnGmArticleDirectory('all')
      directoryRequestRef.current = request
    }
    try {
      const rows = await request
      setDirectory(rows)
      setDirectoryPhase('ready')
    } catch {
      setDirectoryPhase((phase) => directory.length > 0 && phase === 'refreshing' ? 'ready' : 'failed')
      setDirectoryError('The authoritative newsroom directory could not be synchronized.')
    } finally {
      if (directoryRequestRef.current === request) directoryRequestRef.current = null
    }
  }, [directory.length])

  useEffect(() => {
    const opening = enabled && !wasEnabledRef.current
    wasEnabledRef.current = enabled
    if (!enabled || !opening) return
    void loadDirectory(directoryPhase === 'ready')
  }, [directoryPhase, enabled, loadDirectory])

  const clearSelection = useCallback(() => {
    selectionVersionRef.current += 1
    selectedArticleIdRef.current = null
    detailRef.current = null
    setSelectedArticleId(null)
    setDetail(null)
    setDetailPhase('idle')
    setDetailError(null)
  }, [])

  const selectArticle = useCallback(async (
    articleId: string,
  ): Promise<NetNvnGmArticleDetail | null> => {
    const version = ++selectionVersionRef.current
    selectedArticleIdRef.current = articleId
    detailRef.current = null
    setSelectedArticleId(articleId)
    setDetail(null)
    setDetailPhase('loading')
    setDetailError(null)
    let request = detailRequestRef.current
    if (!request || request.id !== articleId) {
      request = { id: articleId, promise: fetchNetNvnGmArticle(articleId) }
      detailRequestRef.current = request
    }
    try {
      const result = await request.promise
      if (selectionVersionRef.current !== version) return null
      if (!result) {
        detailRef.current = null
        setDetailPhase('failed')
        setDetailError('This article is no longer available to the newsroom editor.')
        return null
      }
      detailRef.current = result
      setDetail(result)
      setDetailPhase('ready')
      return result
    } catch {
      if (selectionVersionRef.current !== version) return null
      detailRef.current = null
      setDetail(null)
      setDetailPhase('failed')
      setDetailError('Article detail could not be synchronized.')
      return null
    } finally {
      if (detailRequestRef.current?.promise === request.promise) detailRequestRef.current = null
    }
  }, [])

  const refreshSelectedArticle = useCallback(async (): Promise<NetNvnGmArticleDetail | null> => {
    const articleId = selectedArticleIdRef.current
    if (!articleId) return null
    const version = ++selectionVersionRef.current
    setDetailPhase(detailRef.current ? 'refreshing' : 'loading')
    setDetailError(null)
    const request = fetchNetNvnGmArticle(articleId)
    detailRequestRef.current = { id: articleId, promise: request }
    try {
      const result = await request
      if (
        selectionVersionRef.current !== version
        || selectedArticleIdRef.current !== articleId
      ) return null
      if (!result) {
        detailRef.current = null
        setDetail(null)
        setDetailPhase('failed')
        setDetailError('This article is no longer available to the newsroom editor.')
        return null
      }
      detailRef.current = result
      setDetail(result)
      setDetailPhase('ready')
      return result
    } catch {
      if (
        selectionVersionRef.current !== version
        || selectedArticleIdRef.current !== articleId
      ) return null
      if (detailRef.current) {
        setDetailPhase('ready')
        setDetailError('The selected article changed, but its server version could not be refreshed.')
      } else {
        setDetail(null)
        setDetailPhase('failed')
        setDetailError('Article detail could not be synchronized.')
      }
      return null
    } finally {
      if (detailRequestRef.current?.promise === request) detailRequestRef.current = null
    }
  }, [])

  const acceptDetail = useCallback((saved: NetNvnGmArticleDetail) => {
    selectedArticleIdRef.current = saved.id
    detailRef.current = saved
    setDirectory((rows) => upsertDirectoryRow(rows, saved))
    setSelectedArticleId(saved.id)
    setDetail(saved)
    setDetailPhase('ready')
    setDetailError(null)
    return saved
  }, [])

  const mutate = useCallback(async (
    operation: () => Promise<NetNvnGmArticleDetail>,
  ): Promise<NetNvnGmArticleDetail> => {
    const selectionVersion = selectionVersionRef.current
    const expectedArticleId = selectedArticleIdRef.current
    activeMutationCountRef.current += 1
    setIsMutating(true)
    try {
      const saved = await operation()
      if (
        selectionVersionRef.current === selectionVersion
        && selectedArticleIdRef.current === expectedArticleId
      ) {
        return acceptDetail(saved)
      }
      setDirectory((rows) => upsertDirectoryRow(rows, saved))
      return saved
    } finally {
      activeMutationCountRef.current = Math.max(0, activeMutationCountRef.current - 1)
      if (activeMutationCountRef.current === 0) setIsMutating(false)
    }
  }, [acceptDetail])

  const createArticle = useCallback(
    (input: NetNvnGmArticleInput) => mutate(() => createNetNvnGmArticle(input)),
    [mutate],
  )
  const updateArticle = useCallback(
    (articleId: string, input: NetNvnGmArticleInput) =>
      mutate(() => updateNetNvnGmArticle(articleId, input)),
    [mutate],
  )
  const setLifecycle = useCallback(
    (articleId: string, action: NetNvnGmLifecycleAction) =>
      mutate(() => setNetNvnGmArticleLifecycle(articleId, action)),
    [mutate],
  )
  const setMedia = useCallback(
    (articleId: string, input: NetNvnGmArticleMediaInput) => {
      const previous = detailRef.current?.media.find((item) => input.mediaId
        ? item.id === input.mediaId
        : item.placementKind === 'hero' && input.placementKind === 'hero')
      return mutate(() => setNetNvnGmArticleMedia(articleId, input, previous?.mediaRef))
    },
    [mutate],
  )
  const removeMedia = useCallback(
    (articleId: string, mediaId: string) => {
      const removed = detailRef.current?.media.find((item) => item.id === mediaId)
      return mutate(() => removeNetNvnGmArticleMedia(articleId, mediaId, removed?.mediaRef))
    },
    [mutate],
  )

  return {
    directory,
    directoryPhase,
    directoryError,
    selectedArticleId,
    detail,
    detailPhase,
    detailError,
    isMutating,
    loadDirectory,
    clearSelection,
    selectArticle,
    refreshSelectedArticle,
    createArticle,
    updateArticle,
    setLifecycle,
    setMedia,
    removeMedia,
  }
}
