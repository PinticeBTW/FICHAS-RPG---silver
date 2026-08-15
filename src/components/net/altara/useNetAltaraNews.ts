import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchNetAltaraNewsArticle,
  fetchNetAltaraNewsFeed,
  setNetAltaraNewsSaved,
} from '../../../lib/netAltaraNewsService'
import { subscribeToNetAltaraNews } from '../../../lib/netAltaraNewsRealtimeService'
import type {
  NetAltaraNewsArticleDetail,
  NetAltaraNewsArticleSummary,
  NetAltaraNewsFeed,
  NetAltaraNewsFeedMode,
  NetAltaraNewsRealtimeStatus,
  NetAltaraNewsSection,
} from '../../../lib/netAltaraNewsTypes'

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function updateSavedArticle(
  article: NetAltaraNewsArticleSummary,
  articleId: string,
  saved: boolean,
) {
  return article.articleId === articleId ? { ...article, saved } : article
}

export function useNetAltaraNews(
  enabled: boolean,
  identitySessionKey: string,
  expectedIdentityLinkId?: string,
) {
  const [mode, setMode] = useState<NetAltaraNewsFeedMode>('home')
  const [feed, setFeed] = useState<NetAltaraNewsFeed | null>(null)
  const [detail, setDetail] = useState<NetAltaraNewsArticleDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<NetAltaraNewsRealtimeStatus>('idle')
  const [broadcastInvalidationVersion, setBroadcastInvalidationVersion] = useState(0)
  const [searchInput, setSearchInputState] = useState('')
  const [settledSearch, setSettledSearch] = useState('')
  const [archiveSection, setArchiveSectionState] = useState<NetAltaraNewsSection | undefined>()
  const generationRef = useRef(0)
  const requestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const modeRef = useRef(mode)
  const detailIdRef = useRef<string | null>(null)
  const realtimeTimerRef = useRef<number | null>(null)
  const feedRef = useRef<NetAltaraNewsFeed | null>(null)
  const settledSearchRef = useRef(settledSearch)
  const archiveSectionRef = useRef(archiveSection)

  modeRef.current = mode
  detailIdRef.current = detail?.article.articleId ?? null
  feedRef.current = feed
  settledSearchRef.current = settledSearch
  archiveSectionRef.current = archiveSection

  useEffect(() => {
    const normalized = searchInput.trim()
    if (normalized.length < 3) {
      setSettledSearch(normalized)
      return
    }
    const timer = window.setTimeout(() => setSettledSearch(normalized), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const loadFeed = useCallback(async (
    nextMode: NetAltaraNewsFeedMode,
    generation: number,
    append = false,
  ) => {
    if (!enabled || !expectedIdentityLinkId) return
    requestRef.current += 1
    const request = requestRef.current
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const currentFeed = feedRef.current
      const currentCursor = append && currentFeed?.mode === nextMode ? currentFeed.nextCursor : undefined
      const result = await fetchNetAltaraNewsFeed(expectedIdentityLinkId, nextMode, currentCursor, {
        ...((nextMode === 'search' || nextMode === 'archive') && settledSearchRef.current
          ? { searchQuery: settledSearchRef.current }
          : {}),
        ...(nextMode === 'archive' && archiveSectionRef.current
          ? { section: archiveSectionRef.current }
          : {}),
      })
      if (generationRef.current !== generation || requestRef.current !== request) return
      setFeed((current) => append && current?.mode === nextMode
        ? { ...result, articles: [...current.articles, ...result.articles] }
        : result)
      setError(null)
    } catch (reason) {
      if (generationRef.current !== generation || requestRef.current !== request) return
      setError(message(reason, 'NEWS could not load the current edition.'))
    } finally {
      if (generationRef.current === generation && requestRef.current === request) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [enabled, expectedIdentityLinkId])

  const openArticle = useCallback(async (articleId: string) => {
    if (!enabled || !expectedIdentityLinkId) return
    const generation = generationRef.current
    detailRequestRef.current += 1
    const request = detailRequestRef.current
    setLoading(true)
    try {
      const result = await fetchNetAltaraNewsArticle(expectedIdentityLinkId, articleId)
      if (generationRef.current !== generation || detailRequestRef.current !== request) return
      setDetail(result)
      setError(null)
    } catch (reason) {
      if (generationRef.current === generation && detailRequestRef.current === request) {
        setError(message(reason, 'The article is no longer available.'))
      }
    } finally {
      if (generationRef.current === generation && detailRequestRef.current === request) setLoading(false)
    }
  }, [enabled, expectedIdentityLinkId])

  const selectMode = useCallback((nextMode: NetAltaraNewsFeedMode) => {
    setMode(nextMode)
    modeRef.current = nextMode
    if (nextMode !== 'search' && nextMode !== 'archive') {
      setSearchInputState('')
      setSettledSearch('')
    }
    detailRequestRef.current += 1
    setDetail(null)
    detailIdRef.current = null
    if (nextMode !== 'search' && nextMode !== 'archive') {
      void loadFeed(nextMode, generationRef.current)
    }
  }, [loadFeed])

  useEffect(() => {
    if (!enabled || !expectedIdentityLinkId || (mode !== 'search' && mode !== 'archive')) return
    if ((mode === 'search' && settledSearch.length < 3)
      || (mode === 'archive' && settledSearch.length > 0 && settledSearch.length < 3)) {
      requestRef.current += 1
      if (mode === 'search') setFeed(null)
      setLoading(false)
      setLoadingMore(false)
      return
    }
    void loadFeed(mode, generationRef.current)
  }, [archiveSection, enabled, expectedIdentityLinkId, loadFeed, mode, settledSearch])

  const toggleSaved = useCallback(async (articleId: string, saved: boolean) => {
    if (!expectedIdentityLinkId) return
    const generation = generationRef.current
    setFeed((current) => current ? {
      ...current,
      articles: current.articles.map((article) => updateSavedArticle(article, articleId, saved)),
    } : current)
    setDetail((current) => current ? {
      ...current,
      article: updateSavedArticle(current.article, articleId, saved) as NetAltaraNewsArticleDetail['article'],
    } : current)
    try {
      await setNetAltaraNewsSaved(expectedIdentityLinkId, articleId, saved)
      if (generationRef.current !== generation) return
      if (modeRef.current === 'saved' && !saved) {
        setFeed((current) => current ? {
          ...current,
          articles: current.articles.filter((article) => article.articleId !== articleId),
        } : current)
      }
    } catch (reason) {
      if (generationRef.current !== generation) return
      setFeed((current) => current ? {
        ...current,
        articles: current.articles.map((article) => updateSavedArticle(article, articleId, !saved)),
      } : current)
      setDetail((current) => current ? {
        ...current,
        article: updateSavedArticle(current.article, articleId, !saved) as NetAltaraNewsArticleDetail['article'],
      } : current)
      setError(message(reason, 'The saved state could not be updated.'))
    }
  }, [expectedIdentityLinkId])

  useEffect(() => {
    generationRef.current += 1
    requestRef.current += 1
    detailRequestRef.current += 1
    const generation = generationRef.current
    setMode('home')
    modeRef.current = 'home'
    setFeed(null)
    setDetail(null)
    setError(null)
    setRealtimeStatus('idle')
    setBroadcastInvalidationVersion(0)
    setSearchInputState('')
    setSettledSearch('')
    setArchiveSectionState(undefined)
    if (!enabled || !expectedIdentityLinkId) return
    void loadFeed('home', generation)
  }, [enabled, expectedIdentityLinkId, identitySessionKey, loadFeed]) // deliberately resets exact identity context

  useEffect(() => {
    if (!enabled || !expectedIdentityLinkId) return undefined
    return subscribeToNetAltaraNews((articleChanged, _liveChanged, broadcastChanged) => {
      if (broadcastChanged) setBroadcastInvalidationVersion((current) => current + 1)
      if (!articleChanged) return
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = window.setTimeout(() => {
        realtimeTimerRef.current = null
        const generation = generationRef.current
        if (articleChanged) {
          void loadFeed(modeRef.current, generation)
          const detailId = detailIdRef.current
          if (detailId) {
            detailRequestRef.current += 1
            const request = detailRequestRef.current
            void fetchNetAltaraNewsArticle(expectedIdentityLinkId, detailId).then((result) => {
              if (generationRef.current === generation
                && detailRequestRef.current === request
                && detailIdRef.current === detailId) setDetail(result)
            }).catch((reason: unknown) => {
              if (generationRef.current !== generation
                || detailRequestRef.current !== request
                || detailIdRef.current !== detailId) return
              setDetail(null)
              setError(message(reason, 'The article is no longer published.'))
            })
          }
        }
      }, 220)
    }, setRealtimeStatus)
  }, [enabled, expectedIdentityLinkId, loadFeed])

  useEffect(() => () => {
    if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current)
  }, [])

  return {
    mode,
    feed,
    detail,
    loading,
    loadingMore,
    error,
    realtimeStatus,
    broadcastInvalidationVersion,
    searchInput,
    settledSearch,
    searchTooShort: settledSearch.length > 0 && settledSearch.length < 3,
    searchSettling: searchInput.trim() !== settledSearch,
    archiveSection,
    selectMode,
    setSearchInput: (value: string) => {
      setSearchInputState(value.slice(0, 80))
      if (modeRef.current !== 'archive') {
        modeRef.current = 'search'
        setMode('search')
      }
    },
    setArchiveSection: (section?: NetAltaraNewsSection) => setArchiveSectionState(section),
    openArticle,
    closeArticle: () => {
      detailRequestRef.current += 1
      setDetail(null)
    },
    toggleSaved,
    loadMore: () => feed?.nextCursor
      ? loadFeed(modeRef.current, generationRef.current, true)
      : Promise.resolve(),
    retry: () => {
      const generation = generationRef.current
      void loadFeed(modeRef.current, generation)
    },
  }
}
