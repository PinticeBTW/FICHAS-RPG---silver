import {
  ArrowLeft,
  BookOpenText,
  Clock3,
  Database,
  FileText,
  LoaderCircle,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import {
  fetchNetSearchEntry,
  fetchNetSearchHome,
  searchNetKnowledge,
} from '../../lib/netSearchService'
import {
  cancelNetSearchLocalAiForNewSearch,
  cancelNetSearchLocalAiOperation,
  canGenerateNetSearchLocalAiOverview,
  checkNetSearchLocalAiCapability,
  generateNetSearchLocalAiOverview,
  releaseNetSearchLocalAi,
} from '../../lib/netSearchLocalAi/netSearchLocalAiService'
import {
  NET_SEARCH_QUERY_MAX_LENGTH,
  NET_SEARCH_QUERY_MIN_LENGTH,
  type NetSearchEntryDetail,
  type NetSearchResult,
  type NetSearchSourceKind,
} from '../../lib/netSearchTypes'
import '../../styles/netSearch.css'

import type { NetAppAccessMode } from './netAppCatalog'
import { NetSearchKnowledgeControl } from './NetSearchKnowledgeControl'
import { NetSearchLocalAiOverview } from './NetSearchLocalAiOverview'
import { NetSearchMarkdownPreview } from './NetSearchMarkdownPreview'

interface NetSearchAppProps {
  readonly accessMode: NetAppAccessMode
  readonly enabled: boolean
  readonly historyOwnerKey: string
  readonly onNotice: (message: string) => void
}

const MAX_RECENT_SEARCHES = 8
const SEARCH_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function formatSearchDate(value: string): string {
  return SEARCH_DATE_FORMATTER.format(new Date(value))
}

function resultTypeLabel(value: string): string {
  return value.replaceAll('-', ' ').toUpperCase()
}

function readRecentSearches(key: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item, index, all) => (
        item.length >= NET_SEARCH_QUERY_MIN_LENGTH
        && item.length <= NET_SEARCH_QUERY_MAX_LENGTH
        && all.findIndex((candidate) => candidate.toLocaleLowerCase() === item.toLocaleLowerCase()) === index
      ))
      .slice(0, MAX_RECENT_SEARCHES)
  } catch {
    return []
  }
}

function NetSearchResultCard({
  result,
  onOpen,
}: {
  readonly result: NetSearchResult
  readonly onOpen: (sourceId: string, sourceKind: NetSearchSourceKind) => void
}) {
  const isLoreDocument = result.sourceKind === 'lore_document'
  return (
    <button
      type="button"
      className="net-search-result"
      data-source-kind={result.sourceKind}
      onClick={() => onOpen(result.id, result.sourceKind)}
    >
      <span className="net-search-result__source">
        {isLoreDocument
          ? <FileText size={12} aria-hidden="true" />
          : <Database size={12} aria-hidden="true" />}
        {isLoreDocument ? 'LORE DOCUMENT' : 'CANONICAL ENTRY'}
        <i>{isLoreDocument ? `${result.searchableSections ?? 0} SECTIONS` : resultTypeLabel(result.entryType)}</i>
      </span>
      <strong>{result.title}</strong>
      <p>{result.summary}</p>
      {result.excerpt !== result.summary ? <small>{result.excerpt}</small> : null}
      <span className="net-search-result__meta">
        <Clock3 size={12} aria-hidden="true" /> Updated {formatSearchDate(result.updatedAt)}
        {result.tags.slice(0, 3).map((tag) => <i key={tag}>#{tag}</i>)}
      </span>
      {isLoreDocument ? <b className="net-search-result__open">OPEN SOURCE</b> : null}
    </button>
  )
}

export function NetSearchApp({
  accessMode,
  enabled,
  historyOwnerKey,
  onNotice,
}: NetSearchAppProps) {
  const historyStorageKey = `rpgsilver:veil-search:recent:v1:${historyOwnerKey}`
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [recentSearches, setRecentSearches] = useState<readonly string[]>([])
  const [homeEntries, setHomeEntries] = useState<readonly NetSearchResult[]>([])
  const [results, setResults] = useState<readonly NetSearchResult[]>([])
  const [selectedEntry, setSelectedEntry] = useState<NetSearchEntryDetail | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [detailPhase, setDetailPhase] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const requestGenerationRef = useRef(0)

  useEffect(() => {
    setRecentSearches(readRecentSearches(historyStorageKey))
  }, [historyStorageKey])

  const loadHome = useCallback(async () => {
    const generation = ++requestGenerationRef.current
    setPhase('loading')
    setError(null)
    try {
      const entries = await fetchNetSearchHome()
      if (requestGenerationRef.current !== generation) return
      setHomeEntries(entries)
      setResults([])
      setSubmittedQuery('')
      setPhase('ready')
    } catch (loadError) {
      if (requestGenerationRef.current !== generation) return
      setError(loadError instanceof Error ? loadError.message : 'The VEIL knowledge index is unavailable.')
      setPhase('failed')
    }
  }, [])

  useEffect(() => {
    if (!enabled || accessMode === 'gm-system') return
    void loadHome()
  }, [accessMode, enabled, loadHome])

  useEffect(() => {
    if (!enabled || accessMode === 'gm-system') {
      void releaseNetSearchLocalAi()
      return
    }
    void checkNetSearchLocalAiCapability()
  }, [accessMode, enabled])

  useEffect(() => () => {
    void releaseNetSearchLocalAi()
  }, [])

  const rememberSearch = useCallback((value: string) => {
    setRecentSearches((current) => {
      const next = [
        value,
        ...current.filter((item) => item.toLocaleLowerCase() !== value.toLocaleLowerCase()),
      ].slice(0, MAX_RECENT_SEARCHES)
      try {
        window.localStorage.setItem(historyStorageKey, JSON.stringify(next))
      } catch {
        // Search remains fully usable when device storage is unavailable.
      }
      return next
    })
  }, [historyStorageKey])

  const runSearch = useCallback(async (rawQuery: string) => {
    const normalized = rawQuery.trim()
    if (normalized.length < NET_SEARCH_QUERY_MIN_LENGTH) {
      setError(`Enter at least ${NET_SEARCH_QUERY_MIN_LENGTH} characters to search New Vega.`)
      return
    }

    cancelNetSearchLocalAiForNewSearch()
    const generation = ++requestGenerationRef.current
    setSelectedEntry(null)
    setDetailPhase('idle')
    setSubmittedQuery(normalized)
    setPhase('loading')
    setError(null)
    try {
      const nextResults = await searchNetKnowledge(normalized)
      if (requestGenerationRef.current !== generation) return
      setResults(nextResults)
      setPhase('ready')
      rememberSearch(normalized)
      onNotice(`VEIL SEARCH // ${nextResults.length} INDEX MATCH${nextResults.length === 1 ? '' : 'ES'}`)
      if (canGenerateNetSearchLocalAiOverview()) {
        void generateNetSearchLocalAiOverview(normalized)
      }
    } catch (searchError) {
      if (requestGenerationRef.current !== generation) return
      setResults([])
      setError(searchError instanceof Error ? searchError.message : 'The VEIL knowledge index is unavailable.')
      setPhase('failed')
    }
  }, [onNotice, rememberSearch])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void runSearch(query)
  }

  const openEntry = useCallback(async (entryId: string, sourceKind: NetSearchSourceKind) => {
    cancelNetSearchLocalAiOperation()
    const generation = ++requestGenerationRef.current
    setDetailPhase('loading')
    setError(null)
    try {
      const entry = await fetchNetSearchEntry(entryId, sourceKind)
      if (requestGenerationRef.current !== generation) return
      if (!entry) {
        setError('This knowledge entry is no longer available.')
        setDetailPhase('failed')
        return
      }
      setSelectedEntry(entry)
      setDetailPhase('idle')
    } catch (detailError) {
      if (requestGenerationRef.current !== generation) return
      setError(detailError instanceof Error ? detailError.message : 'The knowledge entry could not be opened.')
      setDetailPhase('failed')
    }
  }, [])

  const clearRecentSearches = () => {
    try {
      window.localStorage.removeItem(historyStorageKey)
    } catch {
      // Local-only history is best-effort device state.
    }
    setRecentSearches([])
  }

  if (accessMode === 'gm-system') {
    return <NetSearchKnowledgeControl enabled={enabled} onNotice={onNotice} />
  }

  return (
    <div className="net-search-app">
      <header className="net-search-topbar">
        <span><Sparkles size={15} aria-hidden="true" /> VEIL SEARCH</span>
        <small>NEW VEGA KNOWLEDGE GRID</small>
      </header>

      <main className="net-search-main">
        {selectedEntry ? (
          <article className="net-search-detail">
            <button type="button" className="net-search-back" onClick={() => setSelectedEntry(null)}>
              <ArrowLeft size={14} aria-hidden="true" /> Back to results
            </button>
            <span className="net-search-detail__source">
              {selectedEntry.sourceKind === 'lore_document'
                ? <FileText size={13} aria-hidden="true" />
                : <Database size={13} aria-hidden="true" />}
              {selectedEntry.sourceKind === 'lore_document'
                ? 'LORE DOCUMENT'
                : `CANONICAL ENTRY · ${resultTypeLabel(selectedEntry.entryType)}`}
            </span>
            <h1>{selectedEntry.title}</h1>
            <p className="net-search-detail__summary">{selectedEntry.summary}</p>
            {selectedEntry.sourceKind === 'lore_document' ? (
              <div className="net-search-detail__document-meta">
                <span><strong>Source</strong>{selectedEntry.sourceLabel || 'GM / Silver lore import'}</span>
                <span><strong>Searchable sections</strong>{selectedEntry.searchableSections ?? 0}</span>
              </div>
            ) : null}
            <div className="net-search-detail__content">
              {selectedEntry.sourceKind === 'lore_document' ? (
                <NetSearchMarkdownPreview content={selectedEntry.content} />
              ) : (
                selectedEntry.content.split(/\n{2,}/).map((paragraph, index) => (
                  <p key={`${selectedEntry.id}:${index}`}>{paragraph}</p>
                ))
              )}
            </div>
            {selectedEntry.aliases.length > 0
              || selectedEntry.tags.length > 0
              || selectedEntry.relatedReferences.length > 0 ? (
              <footer>
                {selectedEntry.aliases.length > 0 ? (
                  <div><strong>Also known as</strong><span>{selectedEntry.aliases.join(' · ')}</span></div>
                ) : null}
                {selectedEntry.tags.length > 0 ? (
                  <div><strong>Index tags</strong><span>{selectedEntry.tags.map((tag) => `#${tag}`).join(' ')}</span></div>
                ) : null}
                {selectedEntry.relatedReferences.length > 0 ? (
                  <div><strong>Related references</strong><span>{selectedEntry.relatedReferences.join(' · ')}</span></div>
                ) : null}
              </footer>
            ) : null}
          </article>
        ) : (
          <>
            <section className="net-search-hero" data-compact={submittedQuery ? 'true' : 'false'}>
              <div className="net-search-hero__mark"><Search size={30} aria-hidden="true" /></div>
              <div>
                <p>VEGA MESH // VERIFIED INDEX</p>
                <h1>Search New Vega</h1>
              </div>
              <form onSubmit={handleSubmit} className="net-search-query">
                <Search size={19} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  minLength={NET_SEARCH_QUERY_MIN_LENGTH}
                  maxLength={NET_SEARCH_QUERY_MAX_LENGTH}
                  placeholder="People, places, events, organizations…"
                  aria-label="Search New Vega knowledge"
                />
                {query ? (
                  <button type="button" onClick={() => setQuery('')} aria-label="Clear query">
                    <X size={15} aria-hidden="true" />
                  </button>
                ) : null}
                <button type="submit">Search</button>
              </form>
            </section>

            {detailPhase === 'loading' ? (
              <div className="net-search-state" role="status"><LoaderCircle className="net-search-spin" /> Opening verified source…</div>
            ) : null}

            {error ? (
              <div className="net-search-error" role="alert">
                <strong>INDEX REQUEST FAILED</strong><span>{error}</span>
                <button type="button" onClick={() => submittedQuery ? void runSearch(submittedQuery) : void loadHome()}>Retry</button>
              </div>
            ) : null}

            {submittedQuery ? (
              <section className="net-search-results-view">
                <NetSearchLocalAiOverview
                  query={submittedQuery}
                  searchReady={phase === 'ready'}
                  onOpenSource={openEntry}
                />

                <header className="net-search-section-head">
                  <div><span>INDEX RESULTS</span><h2>“{submittedQuery}”</h2></div>
                  <small>{phase === 'loading' ? 'SEARCHING' : `${results.length} MATCH${results.length === 1 ? '' : 'ES'}`}</small>
                </header>

                {phase === 'loading' ? (
                  <div className="net-search-state" role="status"><LoaderCircle className="net-search-spin" /> Scanning the bounded knowledge index…</div>
                ) : results.length > 0 ? (
                  <div className="net-search-results">
                    {results.map((result) => <NetSearchResultCard key={`${result.sourceKind}:${result.id}`} result={result} onOpen={openEntry} />)}
                  </div>
                ) : !error ? (
                  <div className="net-search-empty">
                    <Search size={28} aria-hidden="true" />
                    <strong>No verified entries found</strong>
                    <span>Try a known alias, place, organization, event, or broader term.</span>
                  </div>
                ) : null}
              </section>
            ) : (
              <section className="net-search-home">
                {recentSearches.length > 0 ? (
                  <div className="net-search-recents">
                    <header><span><Clock3 size={13} /> RECENT SEARCHES</span><button type="button" onClick={clearRecentSearches}>Clear</button></header>
                    <div>{recentSearches.map((recent) => (
                      <button key={recent} type="button" onClick={() => { setQuery(recent); void runSearch(recent) }}>
                        <Search size={13} aria-hidden="true" /> {recent}
                      </button>
                    ))}</div>
                  </div>
                ) : null}

                <header className="net-search-section-head">
                  <div><span>KNOWLEDGE GRID</span><h2>Latest verified entries</h2></div>
                  <BookOpenText size={20} aria-hidden="true" />
                </header>
                {phase === 'loading' ? (
                  <div className="net-search-state" role="status"><LoaderCircle className="net-search-spin" /> Synchronizing public knowledge…</div>
                ) : homeEntries.length > 0 ? (
                  <div className="net-search-home-grid">
                    {homeEntries.map((entry) => <NetSearchResultCard key={`${entry.sourceKind}:${entry.id}`} result={entry} onOpen={openEntry} />)}
                  </div>
                ) : !error ? (
                  <div className="net-search-empty">
                    <Database size={28} aria-hidden="true" />
                    <strong>The public index is empty</strong>
                    <span>Knowledge published through GM System will appear here.</span>
                  </div>
                ) : null}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
