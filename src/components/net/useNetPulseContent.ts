import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  createCompromisedPulsePost,
  createCompromisedPulseReply,
  createPulsePost,
  createPulseReply,
  deletePulsePost,
  deletePulsePostAsCompromised,
  fetchPulseContentPage,
  getNetPulseContentQueryKey,
  type NetPulseContentPage,
  type NetPulseContentQuery,
  type NetPulseFeed,
  type NetPulsePageCursor,
  type NetPulsePost,
  type NetPulsePublicAuthor,
} from '../../lib/netPulseContentService'
import {
  subscribeToNetPulseInvalidations,
  type NetPulseRealtimeEvent,
} from '../../lib/netPulseRealtimeService'
import {
  isNetPulseContextChangedError,
  type NetPulseRequestContext,
} from '../../lib/netPulseRequestContext'

type NetPulseContentState =
  | {
      readonly status: 'loading'
      readonly key: string | null
      readonly feed: NetPulseFeed
      readonly hasMore: boolean
      readonly loadingMore: boolean
      readonly refreshing: boolean
    }
  | {
      readonly status: 'ready'
      readonly key: string | null
      readonly feed: NetPulseFeed
      readonly hasMore: boolean
      readonly loadingMore: boolean
      readonly refreshing: boolean
    }
  | {
      readonly status: 'error'
      readonly key: string | null
      readonly feed: NetPulseFeed
      readonly hasMore: boolean
      readonly loadingMore: boolean
      readonly refreshing: boolean
      readonly reason: string
    }

export interface NetPulseRevisions {
  readonly content: number
  readonly profile: number
  readonly engagement: number
  readonly notifications: number
  readonly lastOperation: string | null
  readonly lastResourceId: string | null
}

interface PulseCacheEntry {
  readonly feed: NetPulseFeed
  readonly nextCursor: NetPulsePageCursor | null
  readonly hasMore: boolean
  readonly updatedAt: number
  readonly stale: boolean
}

const EMPTY_FEED: NetPulseFeed = { posts: [], authors: [] }
const CACHE_TTL_MS = 60_000
const CACHE_LIMIT = 24
const queryCache = new Map<string, PulseCacheEntry>()
const inFlightPages = new Map<string, Promise<NetPulseContentPage>>()

function mergeAuthors(
  existing: readonly NetPulsePublicAuthor[],
  incoming: readonly NetPulsePublicAuthor[],
): readonly NetPulsePublicAuthor[] {
  const authors = new Map(existing.map((author) => [author.accountId, author]))
  for (const author of incoming) authors.set(author.accountId, author)
  return [...authors.values()]
}

function mergeFeeds(existing: NetPulseFeed, incoming: NetPulseFeed, prepend: boolean): NetPulseFeed {
  // Incoming rows are the newer authoritative snapshot. Build display order
  // independently from value precedence so an older cached duplicate cannot
  // overwrite a freshly fetched row merely because Map keeps the last value.
  const postsById = new Map(existing.posts.map((post) => [post.id, post]))
  for (const post of incoming.posts) postsById.set(post.id, post)
  const orderedIds = prepend
    ? [...incoming.posts.map((post) => post.id), ...existing.posts.map((post) => post.id)]
    : [...existing.posts.map((post) => post.id), ...incoming.posts.map((post) => post.id)]
  const posts = [...new Set(orderedIds)]
    .map((id) => postsById.get(id))
    .filter((post): post is NetPulsePost => Boolean(post))
  return {
    posts,
    authors: mergeAuthors(existing.authors, incoming.authors),
  }
}

function mergeCreatedPost(
  feed: NetPulseFeed,
  post: NetPulsePost,
  author: NetPulsePublicAuthor,
): NetPulseFeed {
  return {
    posts: feed.posts.some((entry) => entry.id === post.id)
      ? feed.posts
      : [post, ...feed.posts],
    authors: mergeAuthors(feed.authors, [author]),
  }
}

function hidePostBranch(feed: NetPulseFeed, postId: string): NetPulseFeed {
  const hiddenIds = new Set<string>([postId])
  let changed = true
  while (changed) {
    changed = false
    for (const post of feed.posts) {
      if (post.parentPostId && hiddenIds.has(post.parentPostId) && !hiddenIds.has(post.id)) {
        hiddenIds.add(post.id)
        changed = true
      }
    }
  }
  return { ...feed, posts: feed.posts.filter((post) => !hiddenIds.has(post.id)) }
}

function setCache(key: string, entry: PulseCacheEntry): void {
  queryCache.delete(key)
  queryCache.set(key, entry)
  while (queryCache.size > CACHE_LIMIT) {
    const oldest = queryCache.keys().next().value
    if (typeof oldest !== 'string') break
    queryCache.delete(oldest)
  }
}

/**
 * Update existing cache entries without delete/reinsert. Re-inserting the
 * current Map key while iterating moves it to the tail, so the live iterator
 * visits it again indefinitely and blocks the UI thread.
 */
function updateSessionCacheEntries(
  sessionKey: string,
  update: (entry: PulseCacheEntry) => PulseCacheEntry,
): void {
  const prefix = `${sessionKey}:`
  for (const [key, entry] of queryCache) {
    if (key.startsWith(prefix)) queryCache.set(key, update(entry))
  }
}

function markSessionCacheStale(sessionKey: string): void {
  updateSessionCacheEntries(sessionKey, (entry) => ({ ...entry, stale: true }))
}

/**
 * A post can be present in City, Following, Search, Profile, Bookmarks and a
 * thread at the same time. Whenever one bounded request confirms engagement,
 * carry only that authoritative social snapshot into the other cached copies.
 * Surface-specific ordering/boost context remains owned by each query.
 */
function reconcileSessionPostSnapshots(
  sessionKey: string,
  authoritativePosts: readonly NetPulsePost[],
): void {
  if (authoritativePosts.length === 0) return
  const authoritativeById = new Map(authoritativePosts.map((post) => [post.id, post]))
  updateSessionCacheEntries(sessionKey, (entry) => {
    let changed = false
    const posts = entry.feed.posts.map((post) => {
      const authoritative = authoritativeById.get(post.id)
      if (!authoritative) return post
      if (
        post.replyCount === authoritative.replyCount
        && post.reactionCount === authoritative.reactionCount
        && post.boostCount === authoritative.boostCount
        && post.viewerReacted === authoritative.viewerReacted
        && post.viewerBoosted === authoritative.viewerBoosted
        && post.viewerBookmarked === authoritative.viewerBookmarked
        && post.viewerFollowsAuthor === authoritative.viewerFollowsAuthor
      ) return post
      changed = true
      return {
        ...post,
        replyCount: authoritative.replyCount,
        reactionCount: authoritative.reactionCount,
        boostCount: authoritative.boostCount,
        viewerReacted: authoritative.viewerReacted,
        viewerBoosted: authoritative.viewerBoosted,
        viewerBookmarked: authoritative.viewerBookmarked,
        viewerFollowsAuthor: authoritative.viewerFollowsAuthor,
      }
    })
    return changed ? { ...entry, feed: { ...entry.feed, posts } } : entry
  })
}

function clearSessionCache(sessionKey: string): void {
  const prefix = `${sessionKey}:`
  for (const key of queryCache.keys()) {
    if (key.startsWith(prefix)) queryCache.delete(key)
  }
}

function fetchPageDeduped(
  cacheKey: string,
  query: NetPulseContentQuery,
  cursor: NetPulsePageCursor | null,
  context: NetPulseRequestContext,
): Promise<NetPulseContentPage> {
  const requestKey = `${cacheKey}:${cursor?.sortAt ?? 'first'}:${cursor?.id ?? 'first'}`
  const existing = inFlightPages.get(requestKey)
  if (existing) return existing
  const request = fetchPulseContentPage(query, cursor, context).finally(() => {
    if (inFlightPages.get(requestKey) === request) inFlightPages.delete(requestKey)
  })
  inFlightPages.set(requestKey, request)
  return request
}

/**
 * One active, cursor-bounded PULSE surface at a time. Other surfaces stay in a
 * short-lived in-memory cache and are merely marked stale by Realtime.
 */
export function useNetPulseContent(
  sessionKey: string | null,
  query: NetPulseContentQuery | null,
  requestContext: NetPulseRequestContext,
  onContextMismatch?: (error: Error) => void,
) {
  const [state, setState] = useState<NetPulseContentState>({
    status: 'loading',
    key: null,
    feed: EMPTY_FEED,
    hasMore: false,
    loadingMore: false,
    refreshing: false,
  })
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [revisions, setRevisions] = useState<NetPulseRevisions>({
    content: 0,
    profile: 0,
    engagement: 0,
    notifications: 0,
    lastOperation: null,
    lastResourceId: null,
  })
  const sessionKeyRef = useRef(sessionKey)
  const queryRef = useRef(query)
  const requestContextRef = useRef(requestContext)
  const onContextMismatchRef = useRef(onContextMismatch)
  const stateRef = useRef(state)
  const submittingRef = useRef(false)
  const deletingRef = useRef(false)
  const requestSequenceRef = useRef(0)
  const realtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousSessionRef = useRef<string | null>(null)
  sessionKeyRef.current = sessionKey
  queryRef.current = query
  requestContextRef.current = requestContext
  onContextMismatchRef.current = onContextMismatch
  stateRef.current = state

  const activeCacheKey = sessionKey && query
    ? `${sessionKey}:${getNetPulseContentQueryKey(query)}`
    : null

  const loadFirstPage = useCallback(async (
    expectedSessionKey: string,
    expectedQuery: NetPulseContentQuery,
    expectedCacheKey: string,
    preserveConfirmed: boolean,
    expectedContext: NetPulseRequestContext,
  ): Promise<void> => {
    const requestSequence = ++requestSequenceRef.current
    const confirmed = queryCache.get(expectedCacheKey)
    setState((current) => ({
      status: preserveConfirmed && (confirmed?.feed.posts.length ?? current.feed.posts.length) > 0
        ? 'ready'
        : 'loading',
      key: expectedCacheKey,
      feed: preserveConfirmed ? confirmed?.feed ?? current.feed : confirmed?.feed ?? EMPTY_FEED,
      hasMore: preserveConfirmed ? confirmed?.hasMore ?? current.hasMore : confirmed?.hasMore ?? false,
      loadingMore: false,
      refreshing: preserveConfirmed,
    }))
    try {
      const page = await fetchPageDeduped(
        expectedCacheKey,
        expectedQuery,
        null,
        expectedContext,
      )
      const activeQuery = queryRef.current
      if (
        sessionKeyRef.current !== expectedSessionKey
        || !activeQuery
        || getNetPulseContentQueryKey(activeQuery) !== getNetPulseContentQueryKey(expectedQuery)
        || requestSequence !== requestSequenceRef.current
      ) return
      reconcileSessionPostSnapshots(expectedSessionKey, page.feed.posts)
      const currentEntry = queryCache.get(expectedCacheKey)
      const mustReplacePage = expectedQuery.mode === 'following' || expectedQuery.mode === 'bookmarks'
      const feed = preserveConfirmed && currentEntry && !mustReplacePage
        ? mergeFeeds(currentEntry.feed, page.feed, true)
        : page.feed
      const entry: PulseCacheEntry = {
        feed,
        nextCursor: preserveConfirmed && currentEntry && !mustReplacePage
          ? currentEntry.nextCursor
          : page.nextCursor,
        hasMore: preserveConfirmed && currentEntry && !mustReplacePage
          ? currentEntry.hasMore
          : page.hasMore,
        updatedAt: Date.now(),
        stale: false,
      }
      setCache(expectedCacheKey, entry)
      setState({
        status: 'ready',
        key: expectedCacheKey,
        feed: entry.feed,
        hasMore: entry.hasMore,
        loadingMore: false,
        refreshing: false,
      })
    } catch (error) {
      if (sessionKeyRef.current !== expectedSessionKey || requestSequence !== requestSequenceRef.current) return
      if (isNetPulseContextChangedError(error)) {
        markSessionCacheStale(expectedSessionKey)
        onContextMismatchRef.current?.(error)
      }
      const retained = queryCache.get(expectedCacheKey)
      setState({
        status: 'error',
        key: expectedCacheKey,
        feed: retained?.feed ?? EMPTY_FEED,
        hasMore: retained?.hasMore ?? false,
        loadingMore: false,
        refreshing: false,
        reason: error instanceof Error ? error.message : 'PULSE public content could not be synchronized.',
      })
    }
  }, [])

  useEffect(() => {
    const previousSession = previousSessionRef.current
    if (previousSession && previousSession !== sessionKey) clearSessionCache(previousSession)
    previousSessionRef.current = sessionKey
    submittingRef.current = false
    deletingRef.current = false
    setSubmitting(false)
    setDeleting(false)
    requestSequenceRef.current += 1

    if (!sessionKey || !query || !activeCacheKey) {
      void Promise.resolve().then(() => setState({
        status: 'ready',
        key: null,
        feed: EMPTY_FEED,
        hasMore: false,
        loadingMore: false,
        refreshing: false,
      }))
      return
    }

    const cached = queryCache.get(activeCacheKey)
    const fresh = cached && !cached.stale && Date.now() - cached.updatedAt <= CACHE_TTL_MS
    if (cached) {
      void Promise.resolve().then(() => setState({
        status: 'ready',
        key: activeCacheKey,
        feed: cached.feed,
        hasMore: cached.hasMore,
        loadingMore: false,
        refreshing: !fresh,
      }))
    }
    if (!fresh) {
      void loadFirstPage(sessionKey, query, activeCacheKey, Boolean(cached), requestContext)
    }
  }, [activeCacheKey, loadFirstPage, query, requestContext, sessionKey])

  useEffect(() => {
    if (!sessionKey) return undefined
    const expectedSessionKey = sessionKey
    const scheduleActiveRefresh = () => {
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = setTimeout(() => {
        realtimeTimerRef.current = null
        const activeQuery = queryRef.current
        if (!activeQuery || sessionKeyRef.current !== expectedSessionKey) return
        const key = `${expectedSessionKey}:${getNetPulseContentQueryKey(activeQuery)}`
        void loadFirstPage(
          expectedSessionKey,
          activeQuery,
          key,
          true,
          requestContextRef.current,
        )
      }, 320)
    }
    const handleRealtime = (event: NetPulseRealtimeEvent) => {
      if (sessionKeyRef.current !== expectedSessionKey) return
      setRevisions({
        content: event.contentRevision,
        profile: event.profileRevision,
        engagement: event.engagementRevision,
        notifications: event.notificationRevision,
        lastOperation: event.operation ?? null,
        lastResourceId: event.resourceId ?? null,
      })
      if (event.entity === 'net_pulse_notifications') return
      markSessionCacheStale(expectedSessionKey)
      if (event.operation === 'soft-delete' && event.resourceId) {
        const deletedResourceId = event.resourceId
        updateSessionCacheEntries(expectedSessionKey, (entry) => ({
          ...entry,
          feed: hidePostBranch(entry.feed, deletedResourceId),
        }))
        setState((current) => ({ ...current, feed: hidePostBranch(current.feed, deletedResourceId) }))
      }
      scheduleActiveRefresh()
    }
    const unsubscribe = subscribeToNetPulseInvalidations(handleRealtime, scheduleActiveRefresh)
    return () => {
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = null
      unsubscribe()
    }
  }, [loadFirstPage, sessionKey])

  const loadMore = useCallback(async (): Promise<void> => {
    const expectedSessionKey = sessionKeyRef.current
    const expectedQuery = queryRef.current
    if (!expectedSessionKey || !expectedQuery) return
    const cacheKey = `${expectedSessionKey}:${getNetPulseContentQueryKey(expectedQuery)}`
    const entry = queryCache.get(cacheKey)
    if (!entry?.hasMore || !entry.nextCursor || stateRef.current.loadingMore) return
    setState((current) => ({ ...current, loadingMore: true }))
    try {
      const page = await fetchPageDeduped(
        cacheKey,
        expectedQuery,
        entry.nextCursor,
        requestContextRef.current,
      )
      const activeQuery = queryRef.current
      if (
        sessionKeyRef.current !== expectedSessionKey
        || !activeQuery
        || getNetPulseContentQueryKey(activeQuery) !== getNetPulseContentQueryKey(expectedQuery)
      ) return
      reconcileSessionPostSnapshots(expectedSessionKey, page.feed.posts)
      const latest = queryCache.get(cacheKey) ?? entry
      const nextEntry: PulseCacheEntry = {
        feed: mergeFeeds(latest.feed, page.feed, false),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        updatedAt: Date.now(),
        stale: false,
      }
      setCache(cacheKey, nextEntry)
      setState({
        status: 'ready',
        key: cacheKey,
        feed: nextEntry.feed,
        hasMore: nextEntry.hasMore,
        loadingMore: false,
        refreshing: false,
      })
    } catch (error) {
      if (sessionKeyRef.current !== expectedSessionKey) return
      if (isNetPulseContextChangedError(error)) {
        markSessionCacheStale(expectedSessionKey)
        onContextMismatchRef.current?.(error)
      }
      setState((current) => ({
        status: 'error',
        key: cacheKey,
        feed: current.feed,
        hasMore: current.hasMore,
        loadingMore: false,
        refreshing: false,
        reason: error instanceof Error ? error.message : 'More PULSE signals could not be loaded.',
      }))
    }
  }, [])

  const create = useCallback(async (input: {
    readonly author: NetPulsePublicAuthor
    readonly body: string
    readonly parentPostId?: string
  }): Promise<NetPulsePost> => {
    if (submittingRef.current) throw new Error('Another PULSE transmission is already pending.')
    const expectedSessionKey = sessionKeyRef.current
    if (!expectedSessionKey) throw new Error('An authenticated PULSE session is required.')
    submittingRef.current = true
    setSubmitting(true)
    try {
      const post = input.parentPostId
        ? await createPulseReply({ authorAccountId: input.author.accountId, parentPostId: input.parentPostId, body: input.body })
        : await createPulsePost({ authorAccountId: input.author.accountId, body: input.body })
      if (sessionKeyRef.current === expectedSessionKey) {
        setState((current) => ({ ...current, status: 'ready', feed: mergeCreatedPost(current.feed, post, input.author) }))
      }
      return post
    } catch (error) {
      if (isNetPulseContextChangedError(error)) {
        markSessionCacheStale(expectedSessionKey)
        onContextMismatchRef.current?.(error)
      }
      throw error
    } finally {
      if (sessionKeyRef.current === expectedSessionKey) {
        submittingRef.current = false
        setSubmitting(false)
      }
    }
  }, [])

  const createCompromised = useCallback(async (input: {
    readonly author: NetPulsePublicAuthor
    readonly body: string
    readonly parentPostId?: string
  }): Promise<NetPulsePost> => {
    if (submittingRef.current) throw new Error('Another PULSE transmission is already pending.')
    const expectedSessionKey = sessionKeyRef.current
    const expectedContext = requestContextRef.current.compromised
    if (!expectedSessionKey || !expectedContext) {
      throw new Error('An authoritative compromised PULSE session is required.')
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      const post = input.parentPostId
        ? await createCompromisedPulseReply({
            parentPostId: input.parentPostId,
            body: input.body,
            context: expectedContext,
          })
        : await createCompromisedPulsePost({ body: input.body, context: expectedContext })
      if (sessionKeyRef.current === expectedSessionKey) {
        setState((current) => ({ ...current, status: 'ready', feed: mergeCreatedPost(current.feed, post, input.author) }))
      }
      return post
    } catch (error) {
      if (isNetPulseContextChangedError(error)) {
        markSessionCacheStale(expectedSessionKey)
        onContextMismatchRef.current?.(error)
      }
      throw error
    } finally {
      if (sessionKeyRef.current === expectedSessionKey) {
        submittingRef.current = false
        setSubmitting(false)
      }
    }
  }, [])

  const removeContent = useCallback(async (postId: string, compromised: boolean): Promise<void> => {
    if (deletingRef.current) throw new Error('Another PULSE deletion is already pending.')
    const expectedSessionKey = sessionKeyRef.current
    const expectedRequestContext = requestContextRef.current
    if (!expectedSessionKey) throw new Error('An authenticated PULSE session is required.')
    if (compromised && !expectedRequestContext.compromised) {
      throw new Error('An authoritative compromised PULSE session is required.')
    }
    if (!compromised && !expectedRequestContext.expectedAccountId) {
      throw new Error('An active PULSE account is required.')
    }
    deletingRef.current = true
    setDeleting(true)
    try {
      const deletedId = compromised
        ? await deletePulsePostAsCompromised(postId, expectedRequestContext.compromised!)
        : await deletePulsePost(postId, expectedRequestContext.expectedAccountId!)
      if (sessionKeyRef.current !== expectedSessionKey) return
      updateSessionCacheEntries(expectedSessionKey, (entry) => ({
        ...entry,
        feed: hidePostBranch(entry.feed, deletedId),
        stale: true,
      }))
      setState((current) => ({ ...current, status: 'ready', feed: hidePostBranch(current.feed, deletedId) }))
    } catch (error) {
      if (isNetPulseContextChangedError(error)) {
        markSessionCacheStale(expectedSessionKey)
        onContextMismatchRef.current?.(error)
      }
      throw error
    } finally {
      if (sessionKeyRef.current === expectedSessionKey) {
        deletingRef.current = false
        setDeleting(false)
      }
    }
  }, [])

  const remove = useCallback((postId: string) => removeContent(postId, false), [removeContent])
  const removeCompromised = useCallback((postId: string) => removeContent(postId, true), [removeContent])

  const refresh = useCallback(async (): Promise<void> => {
    const expectedSessionKey = sessionKeyRef.current
    const expectedQuery = queryRef.current
    if (!expectedSessionKey || !expectedQuery) return
    const key = `${expectedSessionKey}:${getNetPulseContentQueryKey(expectedQuery)}`
    await loadFirstPage(
      expectedSessionKey,
      expectedQuery,
      key,
      true,
      requestContextRef.current,
    )
  }, [loadFirstPage])

  const visibleState = useMemo<NetPulseContentState>(() => {
    if (state.key === activeCacheKey) return state
    if (!activeCacheKey) {
      return {
        status: 'ready',
        key: null,
        feed: EMPTY_FEED,
        hasMore: false,
        loadingMore: false,
        refreshing: false,
      }
    }
    // Navigation history stores route context, not content. Read the current
    // cache synchronously on restoration so confirmed rows remain visible
    // while the effect performs a bounded stale-while-revalidate request.
    const cached = queryCache.get(activeCacheKey)
    if (cached) {
      return {
        status: 'ready',
        key: activeCacheKey,
        feed: cached.feed,
        hasMore: cached.hasMore,
        loadingMore: false,
        refreshing: cached.stale || Date.now() - cached.updatedAt > CACHE_TTL_MS,
      }
    }
    return {
      status: 'loading',
      key: activeCacheKey,
      feed: EMPTY_FEED,
      hasMore: false,
      loadingMore: false,
      refreshing: false,
    }
  }, [activeCacheKey, state])

  return useMemo(() => ({
    state: visibleState,
    submitting,
    deleting,
    revision: revisions.content + revisions.profile + revisions.engagement,
    revisions,
    create,
    createCompromised,
    remove,
    removeCompromised,
    refresh,
    loadMore,
  }), [
    create,
    createCompromised,
    deleting,
    loadMore,
    refresh,
    remove,
    removeCompromised,
    revisions,
    visibleState,
    submitting,
  ])
}
