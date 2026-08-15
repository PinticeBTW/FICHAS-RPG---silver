import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  fetchNetNvnArticle,
  fetchNetNvnArticlePage,
} from '../../lib/netNvnService'
import {
  NET_NVN_SEARCH_MAX_LENGTH,
  NET_NVN_SEARCH_MIN_LENGTH,
  NetNvnRequestError,
  netNvnCategories,
  type NetNvnArticleCursor,
  type NetNvnArticleDetail,
  type NetNvnArticlePage,
  type NetNvnArticlePageRequest,
  type NetNvnArticleSummary,
  type NetNvnCategory,
} from '../../lib/netNvnTypes'

export type NvnReaderNav = 'top' | NetNvnCategory | 'live' | 'archive'

type PageStatus = 'idle' | 'loading' | 'ready'
type DetailStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

interface PageState {
  readonly key: string
  readonly status: PageStatus
  readonly items: readonly NetNvnArticleSummary[]
  readonly hasMore: boolean
  readonly nextCursor?: NetNvnArticleCursor
  readonly refreshing: boolean
  readonly loadingMore: boolean
  readonly error?: string
}

interface DetailState {
  readonly articleId?: string
  readonly status: DetailStatus
  readonly article?: NetNvnArticleDetail
  readonly refreshing?: boolean
  readonly error?: string
}

interface NavigationSnapshot {
  readonly nav: NvnReaderNav
  readonly searchInput: string
  readonly settledSearch: string
  readonly archiveCategory?: NetNvnCategory
  readonly selectedArticleId?: string
}

interface PageDescriptor {
  readonly key: string
  readonly request: NetNvnArticlePageRequest
}

const pageRequests = new Map<string, Promise<NetNvnArticlePage>>()
const detailRequests = new Map<string, Promise<NetNvnArticleDetail | null>>()

function requestPageOnce(
  expectedIdentityLinkId: string,
  key: string,
  request: NetNvnArticlePageRequest,
  requestGeneration?: string,
) {
  const identityKey = `${expectedIdentityLinkId}:${key}`
  const requestKey = requestGeneration
    ? `${identityKey}:generation:${requestGeneration}`
    : identityKey
  const existing = pageRequests.get(requestKey)
  if (existing) return existing
  const pending = fetchNetNvnArticlePage(expectedIdentityLinkId, request).finally(() => {
    if (pageRequests.get(requestKey) === pending) pageRequests.delete(requestKey)
  })
  pageRequests.set(requestKey, pending)
  return pending
}

function requestDetailOnce(
  expectedIdentityLinkId: string,
  articleId: string,
  requestGeneration?: string,
) {
  const requestKey = requestGeneration
    ? `${expectedIdentityLinkId}:${articleId}:generation:${requestGeneration}`
    : `${expectedIdentityLinkId}:${articleId}`
  const existing = detailRequests.get(requestKey)
  if (existing) return existing
  const pending = fetchNetNvnArticle(expectedIdentityLinkId, articleId).finally(() => {
    if (detailRequests.get(requestKey) === pending) detailRequests.delete(requestKey)
  })
  detailRequests.set(requestKey, pending)
  return pending
}

function readableError(error: unknown): string {
  if (error instanceof NetNvnRequestError) {
    if (error.code === 'authentication-required') return 'Sign in again to reach the NVN newsroom.'
    if (error.code === 'invalid-search-query') return error.message
  }
  return 'The newsroom index could not be reached. Check the connection and retry.'
}

function isCategory(value: NvnReaderNav): value is NetNvnCategory {
  return netNvnCategories.includes(value as NetNvnCategory)
}

function mergePageRows(
  current: readonly NetNvnArticleSummary[],
  incoming: readonly NetNvnArticleSummary[],
): readonly NetNvnArticleSummary[] {
  const merged = new Map(current.map((article) => [article.id, article]))
  incoming.forEach((article) => merged.set(article.id, article))
  return Array.from(merged.values())
}

const EMPTY_PAGE: PageState = {
  key: '',
  status: 'idle',
  items: [],
  hasMore: false,
  refreshing: false,
  loadingMore: false,
}

export function useNetNvnReader(
  enabled = true,
  realtimeInvalidationVersion = 0,
  expectedIdentityLinkId?: string,
) {
  const [nav, setNavState] = useState<NvnReaderNav>('top')
  const [searchInput, setSearchInputState] = useState('')
  const [settledSearch, setSettledSearch] = useState('')
  const [archiveCategory, setArchiveCategoryState] = useState<NetNvnCategory | undefined>()
  const [pageState, setPageState] = useState<PageState>(EMPTY_PAGE)
  const [selectedArticleId, setSelectedArticleId] = useState<string | undefined>()
  const [detailState, setDetailState] = useState<DetailState>({ status: 'idle' })
  const [invalidationVersion, setInvalidationVersion] = useState(0)

  const pageSequence = useRef(0)
  const detailSequence = useRef(0)
  const selectedArticleRef = useRef<string | undefined>(undefined)
  const navigationHistory = useRef<NavigationSnapshot[]>([])

  useEffect(() => {
    const normalized = searchInput.trim()
    if (normalized.length < NET_NVN_SEARCH_MIN_LENGTH) {
      setSettledSearch(normalized)
      return
    }
    const timeout = window.setTimeout(() => setSettledSearch(normalized), 300)
    return () => window.clearTimeout(timeout)
  }, [searchInput])

  useEffect(() => () => {
    detailSequence.current += 1
  }, [])

  const searchTooShort =
    settledSearch.length > 0 && settledSearch.length < NET_NVN_SEARCH_MIN_LENGTH

  const pageDescriptor = useMemo<PageDescriptor | null>(() => {
    if (nav === 'live' || searchTooShort) return null

    let request: NetNvnArticlePageRequest
    if (nav === 'archive') {
      request = {
        mode: 'archive',
        ...(archiveCategory ? { category: archiveCategory } : {}),
        ...(settledSearch ? { searchQuery: settledSearch } : {}),
      }
    } else if (settledSearch) {
      request = {
        mode: 'search',
        ...(isCategory(nav) ? { category: nav } : {}),
        searchQuery: settledSearch,
      }
    } else if (isCategory(nav)) {
      request = { mode: 'category', category: nav }
    } else {
      request = { mode: 'home' }
    }

    return { key: JSON.stringify(request), request }
  }, [archiveCategory, nav, searchTooShort, settledSearch])

  const loadFirstPage = useCallback(async (
    preserveConfirmed: boolean,
    requestGeneration?: string,
  ) => {
    if (!enabled || !expectedIdentityLinkId || !pageDescriptor) return
    const sequence = ++pageSequence.current
    const { key, request } = pageDescriptor

    setPageState((current) => {
      const canPreserve = preserveConfirmed && current.key === key && current.items.length > 0
      return {
        key,
        status: canPreserve ? 'ready' : 'loading',
        items: canPreserve ? current.items : [],
        hasMore: canPreserve ? current.hasMore : false,
        ...(canPreserve && current.nextCursor ? { nextCursor: current.nextCursor } : {}),
        refreshing: canPreserve,
        loadingMore: false,
      }
    })

    try {
      const page = await requestPageOnce(
        expectedIdentityLinkId,
        key,
        request,
        requestGeneration,
      )
      if (sequence !== pageSequence.current) return
      setPageState({
        key,
        status: 'ready',
        items: page.items,
        hasMore: page.hasMore,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        refreshing: false,
        loadingMore: false,
      })
    } catch (error) {
      if (sequence !== pageSequence.current) return
      setPageState((current) => ({
        ...current,
        key,
        status: current.items.length > 0 ? 'ready' : 'idle',
        refreshing: false,
        loadingMore: false,
        error: readableError(error),
      }))
    }
  }, [enabled, expectedIdentityLinkId, pageDescriptor])

  useEffect(() => {
    if (!enabled || !expectedIdentityLinkId) {
      pageSequence.current += 1
      detailSequence.current += 1
      return
    }
    if (!pageDescriptor) {
      pageSequence.current += 1
      setPageState({
        ...EMPTY_PAGE,
        key: nav === 'live' ? 'live' : `short-search:${settledSearch}`,
        status: 'ready',
      })
      return
    }

    const requestGeneration = invalidationVersion > 0 || realtimeInvalidationVersion > 0
      ? `${invalidationVersion}:${realtimeInvalidationVersion}`
      : undefined
    void loadFirstPage(true, requestGeneration)
    return () => {
      pageSequence.current += 1
    }
  }, [
    enabled,
    expectedIdentityLinkId,
    invalidationVersion,
    loadFirstPage,
    nav,
    pageDescriptor,
    realtimeInvalidationVersion,
    settledSearch,
  ])

  const loadMore = useCallback(async () => {
    if (
      !enabled
      || !expectedIdentityLinkId
      || !pageDescriptor
      || pageState.key !== pageDescriptor.key
      || !pageState.hasMore
      || !pageState.nextCursor
      || pageState.loadingMore
    ) return

    const sequence = ++pageSequence.current
    const cursor = pageState.nextCursor
    const request = { ...pageDescriptor.request, cursor }
    const requestKey = `${pageDescriptor.key}:${cursor.at}:${cursor.id}`
    setPageState((current) => ({ ...current, loadingMore: true, error: undefined }))

    try {
      const page = await requestPageOnce(expectedIdentityLinkId, requestKey, request)
      if (sequence !== pageSequence.current) return
      setPageState((current) => ({
        ...current,
        items: mergePageRows(current.items, page.items),
        hasMore: page.hasMore,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : { nextCursor: undefined }),
        loadingMore: false,
      }))
    } catch (error) {
      if (sequence !== pageSequence.current) return
      setPageState((current) => ({
        ...current,
        loadingMore: false,
        error: readableError(error),
      }))
    }
  }, [enabled, expectedIdentityLinkId, pageDescriptor, pageState.hasMore, pageState.key, pageState.loadingMore, pageState.nextCursor])

  const loadDetail = useCallback(async (
    articleId: string,
    preserveConfirmed = false,
    requestGeneration?: string,
  ) => {
    if (!enabled || !expectedIdentityLinkId) return
    const sequence = ++detailSequence.current
    setDetailState((current) => (
      preserveConfirmed && current.articleId === articleId && current.article
        ? { ...current, status: 'ready', refreshing: true, error: undefined }
        : { articleId, status: 'loading' }
    ))
    try {
      const article = await requestDetailOnce(
        expectedIdentityLinkId,
        articleId,
        requestGeneration,
      )
      if (sequence !== detailSequence.current || selectedArticleRef.current !== articleId) return
      setDetailState(
        article
          ? { articleId, status: 'ready', article }
          : { articleId, status: 'unavailable' },
      )
    } catch (error) {
      if (sequence !== detailSequence.current || selectedArticleRef.current !== articleId) return
      setDetailState((current) => (
        preserveConfirmed && current.articleId === articleId && current.article
          ? {
              ...current,
              status: 'ready',
              refreshing: false,
              error: readableError(error),
            }
          : {
              articleId,
              status: 'idle',
              error: readableError(error),
            }
      ))
    }
  }, [enabled, expectedIdentityLinkId])

  useEffect(() => {
    const articleId = selectedArticleRef.current
    if (
      !enabled
      || !articleId
      || (invalidationVersion === 0 && realtimeInvalidationVersion === 0)
    ) return
    void loadDetail(
      articleId,
      true,
      `${invalidationVersion}:${realtimeInvalidationVersion}`,
    )
  }, [enabled, invalidationVersion, loadDetail, realtimeInvalidationVersion])

  const snapshot = useCallback((): NavigationSnapshot => ({
    nav,
    searchInput,
    settledSearch,
    ...(archiveCategory ? { archiveCategory } : {}),
    ...(selectedArticleId ? { selectedArticleId } : {}),
  }), [archiveCategory, nav, searchInput, selectedArticleId, settledSearch])

  const openArticle = useCallback((articleId: string) => {
    if (!enabled) return
    navigationHistory.current.push(snapshot())
    selectedArticleRef.current = articleId
    setSelectedArticleId(articleId)
    void loadDetail(articleId)
  }, [enabled, loadDetail, snapshot])

  const goBack = useCallback(() => {
    detailSequence.current += 1
    const previous = navigationHistory.current.pop()
    const previousArticleId = previous?.selectedArticleId
    setNavState(previous?.nav ?? nav)
    setSearchInputState(previous?.searchInput ?? searchInput)
    setSettledSearch(previous?.settledSearch ?? settledSearch)
    setArchiveCategoryState(previous?.archiveCategory)
    selectedArticleRef.current = previousArticleId
    setSelectedArticleId(previousArticleId)
    setDetailState({ status: 'idle' })
    if (previousArticleId) void loadDetail(previousArticleId)
  }, [loadDetail, nav, searchInput, settledSearch])

  const setNav = useCallback((nextNav: NvnReaderNav) => {
    const contextWillChange =
      nextNav !== nav || searchInput.length > 0 || archiveCategory !== undefined
    const wasViewingArticle = Boolean(selectedArticleRef.current)
    detailSequence.current += 1
    navigationHistory.current = []
    selectedArticleRef.current = undefined
    setSelectedArticleId(undefined)
    setDetailState({ status: 'idle' })
    setSearchInputState('')
    setSettledSearch('')
    setArchiveCategoryState(undefined)
    setNavState(nextNav)
    if (!contextWillChange && !wasViewingArticle) void loadFirstPage(true)
  }, [archiveCategory, loadFirstPage, nav, searchInput.length])

  const setSearchInput = useCallback((value: string) => {
    setSearchInputState(value.slice(0, NET_NVN_SEARCH_MAX_LENGTH))
  }, [])

  const setArchiveCategory = useCallback((category?: NetNvnCategory) => {
    setArchiveCategoryState(category)
  }, [])

  const invalidate = useCallback(() => {
    setInvalidationVersion((version) => version + 1)
  }, [])

  const currentPage = pageDescriptor && pageState.key === pageDescriptor.key
    ? pageState
    : { ...EMPTY_PAGE, key: pageDescriptor?.key ?? pageState.key }

  return {
    nav,
    setNav,
    searchInput,
    setSearchInput,
    settledSearch,
    searchTooShort,
    searchSettling: searchInput.trim() !== settledSearch,
    archiveCategory,
    setArchiveCategory,
    articles: currentPage.items,
    pageStatus: currentPage.status,
    pageError: currentPage.error,
    hasMore: currentPage.hasMore,
    refreshing: currentPage.refreshing,
    loadingMore: currentPage.loadingMore,
    retryPage: () => loadFirstPage(true),
    loadMore,
    selectedArticleId,
    detail: detailState.article,
    detailStatus: detailState.status,
    detailRefreshing: Boolean(detailState.refreshing),
    detailError: detailState.error,
    openArticle,
    retryDetail: () => selectedArticleId && loadDetail(selectedArticleId, Boolean(detailState.article)),
    goBack,
    invalidate,
  }
}
