import {
  AlertTriangle,
  Archive,
  Bookmark,
  Check,
  ChevronRight,
  Eye,
  Globe2,
  Landmark,
  LoaderCircle,
  MapPin,
  Newspaper,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Save,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'

import {
  fetchNetAltaraNewsGmArticle,
  fetchNetAltaraNewsGmArticles,
  removeNetAltaraNewsGmArticleMedia,
  saveNetAltaraNewsGmArticle,
  setNetAltaraNewsGmArticleLifecycle,
  setNetAltaraNewsGmArticleMedia,
} from '../../../lib/netAltaraNewsService'
import {
  ALTARA_NEWS_PRODUCT_NAME,
  type NetAltaraNewsArticleDraft,
  type NetAltaraNewsArticleMedia,
  type NetAltaraNewsFeedMode,
  type NetAltaraNewsGmArticle,
  type NetAltaraNewsGmArticleMediaInput,
  type NetAltaraNewsGmArticleSummary,
  type NetAltaraNewsSection,
} from '../../../lib/netAltaraNewsTypes'
import { AltaraNewsArticleBody, AltaraNewsArticleHero } from './AltaraNewsArticleMedia'
import { AltaraNewsroomMediaEditor } from './AltaraNewsroomMediaEditor'
import { AltaraNewsBroadcastDesk } from './AltaraNewsBroadcastDesk'
import { AltaraNewsBroadcastControl } from './AltaraNewsBroadcastControl'
import { NewsPlatformArchive } from '../news/NewsPlatformArchive'
import { NewsPlatformArticleReader } from '../news/NewsPlatformArticleReader'
import { NewsPlatformHome } from '../news/NewsPlatformHome'
import { NewsPlatformConfirmation } from '../news/NewsPlatformConfirmation'
import { NewsPlatformFeedback } from '../news/NewsPlatformFeedback'
import { adaptAltaraNewsDetail, adaptAltaraNewsSummary } from './altaraNewsPlatformAdapter'
import { useNetAltaraNews } from './useNetAltaraNews'
import { useNetAltaraNewsBroadcast } from './useNetAltaraNewsBroadcast'

import '../../../styles/altaraNews.css'

export type AltaraNewsMode = 'reader' | 'newsroom'

interface AltaraNewsAppProps {
  readonly mode: AltaraNewsMode
  readonly enabled: boolean
  readonly identitySessionKey: string
  readonly expectedIdentityLinkId?: string
  readonly identityName: string
  readonly onNotice: (message: string) => void
}

type AltaraNewsReaderTab = NetAltaraNewsFeedMode | 'broadcast'

const playerTabs: readonly { id: AltaraNewsReaderTab; label: string }[] = [
  { id: 'home', label: 'HOME' },
  { id: 'local', label: 'LOCAL' },
  { id: 'world', label: 'WORLD' },
  { id: 'business', label: 'BUSINESS' },
  { id: 'technology', label: 'TECH' },
  { id: 'culture', label: 'CULTURE' },
  { id: 'broadcast', label: 'RADIO' },
  { id: 'saved', label: 'SAVED' },
  { id: 'archive', label: 'ARCHIVE' },
]

const sectionLabels: Record<NetAltaraNewsSection, string> = {
  world: 'WORLD',
  business: 'BUSINESS',
  technology: 'TECHNOLOGY',
  culture: 'CULTURE',
}

const feedLabels: Record<Exclude<NetAltaraNewsFeedMode, 'search' | 'archive'>, { eyebrow: string; title: string; copy: string }> = {
  home: {
    eyebrow: 'ALTARA NETWORK EDITION',
    title: 'Global briefing',
    copy: 'Reporting from every connected city, gathered into one authoritative edition.',
  },
  local: {
    eyebrow: 'CITY DESKS',
    title: 'Local, across the network',
    copy: 'City reporting from every ALTARA-connected bureau. Location is editorial context, never a reading boundary.',
  },
  world: {
    eyebrow: 'WORLD DESK',
    title: 'Global coverage',
    copy: 'Stories whose scope crosses cities or is not tied to one specific location.',
  },
  business: {
    eyebrow: 'BUSINESS DESK',
    title: 'Markets & enterprise',
    copy: 'Institutions, industry and economic reporting from across the external world.',
  },
  technology: {
    eyebrow: 'TECHNOLOGY DESK',
    title: 'Systems & futures',
    copy: 'Infrastructure, networks, cyberware and the technologies shaping connected cities.',
  },
  culture: {
    eyebrow: 'CULTURE DESK',
    title: 'Culture & life',
    copy: 'Music, fashion, nightlife and the creative pulse of ALTARA-connected cities.',
  },
  saved: {
    eyebrow: 'PRIVATE LIBRARY',
    title: 'Saved coverage',
    copy: 'A private reading list bound to this exact ALTARA identity.',
  },
}

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'TIME UNAVAILABLE'
    : date.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function coverageLabel(coverageScope: 'world' | 'local', locationLabel?: string) {
  return coverageScope === 'local' ? locationLabel ?? 'CITY DESK' : 'WORLD NETWORK'
}

function ArticleDetail({
  detail,
  onBack,
  onToggleSaved,
  onCopy,
  onOpenRelated,
}: {
  readonly detail: NonNullable<ReturnType<typeof useNetAltaraNews>['detail']>
  readonly onBack: () => void
  readonly onToggleSaved: () => void
  readonly onCopy: () => void
  readonly onOpenRelated: (articleId: string) => void
}) {
  const article = detail.article
  const platformArticle = adaptAltaraNewsDetail(detail)
  return (
    <NewsPlatformArticleReader
      classNamePrefix="altara-news"
      article={platformArticle}
      backLabel="Back to edition"
      copyLabel="Copy reference"
      hero={<AltaraNewsArticleHero media={detail.media} />}
      body={<AltaraNewsArticleBody body={article.body} media={detail.media} />}
      related={detail.related.map(adaptAltaraNewsSummary)}
      relatedLabel="Related coverage"
      onBack={onBack}
      onSavedChange={platformArticle.status === 'published' ? onToggleSaved : undefined}
      onCopyReference={onCopy}
      onOpenRelated={onOpenRelated}
    />
  )
}

function AltaraNewsReader({
  enabled,
  identitySessionKey,
  expectedIdentityLinkId,
  identityName,
  onNotice,
}: Omit<AltaraNewsAppProps, 'mode'>) {
  const controller = useNetAltaraNews(enabled, identitySessionKey, expectedIdentityLinkId)
  const [specialDesk, setSpecialDesk] = useState<'broadcast' | null>(null)
  const broadcast = useNetAltaraNewsBroadcast(
    enabled && specialDesk === 'broadcast',
    expectedIdentityLinkId,
    controller.broadcastInvalidationVersion,
  )
  const [localCity, setLocalCity] = useState('all')
  const feed = controller.feed
  const availableCities = useMemo(() => [...new Set(
    (feed?.articles ?? [])
      .filter((article) => article.coverageScope === 'local' && article.locationLabel)
      .map((article) => article.locationLabel as string),
  )].sort((a, b) => a.localeCompare(b)), [feed])
  const effectiveLocalCity = localCity === 'all' || availableCities.includes(localCity) ? localCity : 'all'
  const visibleArticles = useMemo(() => (
    controller.mode === 'local' && effectiveLocalCity !== 'all'
      ? (feed?.articles ?? []).filter((article) => article.locationLabel === effectiveLocalCity)
      : feed?.articles ?? []
  ), [controller.mode, effectiveLocalCity, feed])
  const breaking = feed?.articles.find((article) => article.priority === 'breaking')

  const chooseTab = (tab: AltaraNewsReaderTab) => {
    controller.closeArticle()
    setSpecialDesk(tab === 'broadcast' ? tab : null)
    if (tab !== 'broadcast') {
      if (tab !== 'local') setLocalCity('all')
      controller.selectMode(tab)
    }
  }

  const copyReference = async (articleId: string) => {
    const reference = JSON.stringify({ appId: 'altara-news', articleId })
    try {
      await navigator.clipboard.writeText(reference)
      onNotice('NEWS // ARTICLE REFERENCE COPIED')
    } catch {
      onNotice('NEWS // COPY UNAVAILABLE')
    }
  }

  if (!expectedIdentityLinkId) {
    return <AltaraNewsState icon={<ShieldCheck />} title="Reader identity required" copy="Use an eligible ALTARA runtime identity to open its NEWS edition and private saved list." />
  }

  return (
    <section className="altara-news" data-design-seed="9383270e">
      <header className="altara-news-header">
        <div className="altara-news-brand"><span><Newspaper size={21} aria-hidden="true" /></span><div><small>ALTARA // GLOBAL NEWS NETWORK</small><h1>{ALTARA_NEWS_PRODUCT_NAME}</h1></div></div>
        <div className="altara-news-context"><small>NETWORK EDITION</small><strong>{identityName}</strong><span data-online={controller.realtimeStatus === 'subscribed'}>{controller.realtimeStatus === 'subscribed' ? 'LIVE WIRE CONNECTED' : 'AUTHORITATIVE FEED'}</span></div>
      </header>

      {breaking ? <button className="altara-news-breaking" type="button" onClick={() => void controller.openArticle(breaking.articleId)}><b>BREAKING</b><span>{breaking.locationLabel ? `${breaking.locationLabel} // ` : ''}{breaking.headline}</span><ChevronRight size={15} /></button> : null}

      <nav className="altara-news-nav" aria-label="NEWS sections">
        {playerTabs.map((tab) => (
          <button key={tab.id} type="button" data-active={specialDesk ? tab.id === specialDesk : tab.id === controller.mode} onClick={() => chooseTab(tab.id)}>
            {tab.id === 'broadcast' ? <Radio size={12} aria-hidden="true" /> : tab.id === 'saved' ? <Bookmark size={12} aria-hidden="true" /> : null}
            {tab.label}
          </button>
        ))}
      </nav>

      {!specialDesk && controller.mode !== 'archive' ? (
        <div className="altara-news-search">
          <Search size={14} aria-hidden="true" />
          <input
            value={controller.searchInput}
            onChange={(event) => controller.setSearchInput(event.target.value)}
            maxLength={80}
            placeholder="Search headlines, cities, sources"
            aria-label="Search published ALTARA NEWS stories"
          />
          {controller.searchInput ? <button type="button" onClick={() => { controller.setSearchInput(''); controller.selectMode('home') }} aria-label="Clear search"><X size={13} /></button> : null}
        </div>
      ) : null}

      {controller.error ? <div className="altara-news-error" role="alert"><AlertTriangle size={15} /><span>{controller.error}</span><button type="button" onClick={controller.retry}><RefreshCw size={13} /> RETRY</button></div> : null}

      <div className="altara-news-reader">
        {controller.detail ? (
          <ArticleDetail
            detail={controller.detail}
            onBack={controller.closeArticle}
            onToggleSaved={() => void controller.toggleSaved(controller.detail!.article.articleId, !controller.detail!.article.saved)}
            onCopy={() => void copyReference(controller.detail!.article.articleId)}
            onOpenRelated={(articleId) => void controller.openArticle(articleId)}
          />
        ) : specialDesk === 'broadcast' ? (
          <AltaraNewsBroadcastDesk broadcast={broadcast} />
        ) : controller.mode === 'archive' ? (
          <NewsPlatformArchive
            classNamePrefix="altara-news"
            productName="ALTARA NEWS"
            articles={(feed?.articles ?? []).map(adaptAltaraNewsSummary)}
            searchInput={controller.searchInput}
            category={controller.archiveSection}
            categories={sectionLabels}
            searchTooShort={controller.searchTooShort}
            searchSettling={controller.searchSettling}
            loading={controller.loading && !feed}
            refreshing={controller.loading && Boolean(feed)}
            loadingMore={controller.loadingMore}
            hasMore={Boolean(feed?.nextCursor)}
            error={controller.error ?? undefined}
            onSearchChange={controller.setSearchInput}
            onCategoryChange={(value) => controller.setArchiveSection(value as NetAltaraNewsSection | undefined)}
            onOpenArticle={(articleId) => void controller.openArticle(articleId)}
            onLoadMore={() => void controller.loadMore()}
            onRetry={controller.retry}
            onCopyReference={(article) => void copyReference(article.id)}
          />
        ) : controller.mode === 'search' && (controller.searchTooShort || controller.searchSettling) ? (
          <NewsPlatformFeedback
            classNamePrefix="altara-news"
            title={controller.searchSettling ? 'Preparing search' : 'Search needs more signal'}
            detail={controller.searchSettling ? 'Waiting for the newsroom query to settle.' : 'Enter at least three characters to search published stories.'}
            loading={controller.searchSettling}
          />
        ) : controller.loading && !feed ? (
          <AltaraNewsState icon={<LoaderCircle className="altara-news-spin" />} title="Loading the global edition" copy="Resolving the current ALTARA identity and bounded newsroom feed." />
        ) : !feed?.articles.length ? (
          <AltaraNewsEmpty icon={controller.mode === 'saved' ? <Bookmark /> : <Newspaper />} title={controller.mode === 'saved' ? 'No saved articles' : 'No published coverage yet'} copy={controller.mode === 'saved' ? 'Save any published article to build a private reading list for this exact identity.' : 'The newsroom has not published reporting for this section yet.'} />
        ) : (
          <>
            {controller.mode === 'local' ? (
              <section className="altara-news-city-filter" aria-label="City coverage filter">
                <div><small>NETWORK CITY INDEX</small><strong>View local reporting by origin</strong></div>
                <div><button type="button" data-active={effectiveLocalCity === 'all'} onClick={() => setLocalCity('all')}>ALL CITIES</button>{availableCities.map((city) => <button key={city} type="button" data-active={effectiveLocalCity === city} onClick={() => setLocalCity(city)}>{city}</button>)}</div>
              </section>
            ) : null}

            <NewsPlatformHome
              classNamePrefix="altara-news"
              heading={controller.mode === 'search'
                ? `Search · ${controller.settledSearch}`
                : controller.mode === 'home'
                  ? 'Top Stories'
                  : feedLabels[controller.mode].title}
              scopeLabel={controller.mode === 'local'
                ? 'All ALTARA-connected city desks'
                : controller.mode === 'search'
                  ? 'Bounded published newsroom index'
                  : 'Global ALTARA newsroom record'}
              articles={visibleArticles.map(adaptAltaraNewsSummary)}
              hasMore={Boolean(feed.nextCursor)}
              loadingMore={controller.loadingMore}
              spotlightLabel="Featured coverage"
              preferSpotlightLead
              includeLeadInSpotlights={false}
              onOpenArticle={(articleId) => void controller.openArticle(articleId)}
              onLoadMore={() => void controller.loadMore()}
            />
          </>
        )}
      </div>
    </section>
  )
}

function blankArticle(): NetAltaraNewsArticleDraft {
  return { slug: '', section: 'world', coverageScope: 'world', priority: 'standard', headline: '', deck: '', body: '', authorLabel: 'ALTARA NEWSROOM', sourceLabel: '', locationLabel: '', featured: false }
}

function errorCopy(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'The newsroom action could not be completed.'
}

function newsroomSnapshot(value: unknown) {
  return JSON.stringify(value)
}

function EditorHeading({ label, title, status }: { readonly label: string; readonly title: string; readonly status: string }) {
  return <div className="altara-newsroom-editor__heading"><div><small>{label}</small><h2>{title}</h2></div><b data-status={status}>{status.toUpperCase()}</b></div>
}

function ArticleDraftPreview({
  article,
  media,
}: {
  readonly article: NetAltaraNewsArticleDraft
  readonly media: readonly NetAltaraNewsArticleMedia[]
}) {
  return (
    <aside className="altara-newsroom-preview">
      <header><Eye size={14} /><span><small>READER PREVIEW</small><strong>UNPUBLISHED VIEW</strong></span></header>
      <div className="altara-newsroom-preview__signal"><Globe2 size={22} /><small>{coverageLabel(article.coverageScope, article.locationLabel)}</small></div>
      <div className="altara-news-meta"><span>{article.coverageScope.toUpperCase()}</span>{article.locationLabel ? <span><MapPin size={11} /> {article.locationLabel}</span> : null}<span>{sectionLabels[article.section]}</span></div>
      <h3>{article.headline.trim() || 'Untitled report'}</h3>
      {article.deck.trim() ? <p className="altara-newsroom-preview__deck">{article.deck}</p> : null}
      <div className="altara-newsroom-preview__byline">BY {article.authorLabel || 'ALTARA NEWSROOM'}{article.sourceLabel ? ` · ${article.sourceLabel}` : ''}</div>
      <AltaraNewsArticleHero media={media} />
      <AltaraNewsArticleBody
        body={article.body}
        media={media}
        emptyMessage="Article copy will appear here as the newsroom writes."
      />
    </aside>
  )
}

function AltaraNewsroom({ enabled, onNotice }: { readonly enabled: boolean; readonly onNotice: (message: string) => void }) {
  const [desk, setDesk] = useState<'articles' | 'broadcast'>('articles')
  const [articles, setArticles] = useState<readonly NetAltaraNewsGmArticleSummary[]>([])
  const [article, setArticle] = useState<NetAltaraNewsArticleDraft>(blankArticle)
  const [articleMedia, setArticleMedia] = useState<readonly NetAltaraNewsArticleMedia[]>([])
  const [articleStatus, setArticleStatus] = useState<NetAltaraNewsGmArticle['status']>('draft')
  const [preview, setPreview] = useState(false)
  const [confirmArticleAction, setConfirmArticleAction] = useState<'unpublish' | 'archive' | null>(null)
  const [mediaToRemove, setMediaToRemove] = useState<NetAltaraNewsArticleMedia | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [articleBaseline, setArticleBaseline] = useState(() => newsroomSnapshot({ article: blankArticle(), media: [] }))
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const generationRef = useRef(0)
  const transitionRef = useRef<(() => void) | null>(null)
  const articleDirty = newsroomSnapshot({ article, media: articleMedia }) !== articleBaseline
  const activeDirty = desk === 'articles' && articleDirty

  const requestTransition = (transition: () => void) => {
    if (!activeDirty) {
      transition()
      return
    }
    transitionRef.current = transition
    setConfirmDiscard(true)
  }

  const reload = useCallback(async () => {
    const generation = generationRef.current
    setLoading(true)
    try {
      const nextArticles = await fetchNetAltaraNewsGmArticles()
      if (generationRef.current !== generation) return
      setArticles(nextArticles)
      setError(null)
    } catch (reason) {
      if (generationRef.current === generation) setError(errorCopy(reason))
    } finally {
      if (generationRef.current === generation) setLoading(false)
    }
  }, [])

  useEffect(() => {
    generationRef.current += 1
    if (enabled) void reload()
    return () => { generationRef.current += 1 }
  }, [enabled, reload])

  const run = async (operation: () => Promise<void>) => {
    setPending(true)
    setError(null)
    try { await operation() } catch (reason) { setError(errorCopy(reason)) } finally { setPending(false) }
  }

  const loadArticle = async (articleId: string) => run(async () => {
    const result = await fetchNetAltaraNewsGmArticle(articleId)
    setArticle(result)
    setArticleMedia(result.media)
    setArticleStatus(result.status)
    setConfirmArticleAction(null)
    setMediaToRemove(null)
    setDesk('articles')
    setArticleBaseline(newsroomSnapshot({ article: result, media: result.media }))
  })
  const editArticle = (articleId: string) => requestTransition(() => { void loadArticle(articleId) })

  const persistArticle = async () => {
    let savedSuccessfully = false
    await run(async () => {
      const saved = await saveNetAltaraNewsGmArticle(article)
      setArticle(saved)
      setArticleMedia(saved.media)
      setArticleStatus(saved.status)
      setArticleBaseline(newsroomSnapshot({ article: saved, media: saved.media }))
      await reload()
      onNotice('NEWSROOM // ARTICLE SAVED')
      savedSuccessfully = true
    })
    return savedSuccessfully
  }
  const submitArticle = (event: FormEvent) => {
    event.preventDefault()
    void persistArticle()
  }
  const articleLifecycle = (action: 'publish' | 'unpublish' | 'archive' | 'restore') => void run(async () => {
    if (!article.articleId) return
    const saved = await setNetAltaraNewsGmArticleLifecycle(article.articleId, action)
    const notice = action === 'publish' ? 'PUBLISHED' : action === 'unpublish' ? 'UNPUBLISHED' : action === 'restore' ? 'RESTORED' : 'ARCHIVED'
    setArticle(saved)
    setArticleMedia(saved.media)
    setArticleStatus(saved.status)
    setArticleBaseline(newsroomSnapshot({ article: saved, media: saved.media }))
    setConfirmArticleAction(null)
    await reload()
    onNotice(`NEWSROOM // ARTICLE ${notice}`)
  })
  const attachArticleMedia = async (input: NetAltaraNewsGmArticleMediaInput) => {
    if (!article.articleId) throw new Error('Save the draft before adding media.')
    const previousMediaRef = input.mediaId
      ? articleMedia.find((item) => item.id === input.mediaId)?.mediaRef
      : undefined
    const saved = await setNetAltaraNewsGmArticleMedia(article.articleId, input, previousMediaRef)
    setArticle(saved)
    setArticleMedia(saved.media)
    setArticleStatus(saved.status)
    setArticleBaseline(newsroomSnapshot({ article: saved, media: saved.media }))
  }

  const removeArticleMedia = () => void run(async () => {
    if (!article.articleId || !mediaToRemove) return
    const saved = await removeNetAltaraNewsGmArticleMedia(
      article.articleId,
      mediaToRemove.id,
      mediaToRemove.mediaRef,
    )
    setArticle(saved)
    setArticleMedia(saved.media)
    setArticleStatus(saved.status)
    setMediaToRemove(null)
    setArticleBaseline(newsroomSnapshot({ article: saved, media: saved.media }))
    onNotice('NEWSROOM // ARTICLE MEDIA REMOVED')
  })

  const selectDesk = (nextDesk: 'articles' | 'broadcast') => {
    if (nextDesk === desk) return
    requestTransition(() => {
      setDesk(nextDesk)
      setConfirmArticleAction(null)
    })
  }

  const newRecord = () => requestTransition(() => {
    setConfirmArticleAction(null)
    const next = blankArticle()
    setArticle(next)
    setArticleMedia([])
    setArticleStatus('draft')
    setPreview(false)
    setArticleBaseline(newsroomSnapshot({ article: next, media: [] }))
  })

  const articleMissingFields = [
    !article.slug.trim() ? 'slug' : '',
    !article.headline.trim() ? 'headline' : '',
    !article.body.trim() ? 'article body' : '',
    !article.authorLabel.trim() ? 'author' : '',
    article.coverageScope === 'local' && !article.locationLabel.trim() ? 'location / city label' : '',
  ].filter(Boolean)
  const articleCanSave = articleMissingFields.length === 0

  return (
    <section className="altara-news altara-newsroom" data-design-seed="9383270e">
      <header className="altara-news-header"><div className="altara-news-brand"><span><Landmark size={21} /></span><div><small>ALTARA // EDITORIAL CONTROL</small><h1>NEWSROOM</h1></div></div><div className="altara-news-context"><small>AUTHORITY</small><strong>SILVER / GM SYSTEM</strong><span>SERVER VERIFIED</span></div></header>
      <nav className="altara-news-nav" aria-label="Newsroom desks"><button type="button" data-active={desk === 'articles'} onClick={() => selectDesk('articles')}><Newspaper size={13} /> ARTICLES</button><button type="button" data-active={desk === 'broadcast'} title="Synchronized global audio and radio" aria-label="Broadcast — synchronized audio and radio" onClick={() => selectDesk('broadcast')}><Radio size={13} /> BROADCAST</button><button type="button" disabled={desk === 'broadcast' || loading} title={desk === 'broadcast' ? 'Broadcast synchronizes automatically' : 'Refresh editorial ledger'} onClick={() => void reload()}><RefreshCw size={13} /> REFRESH</button></nav>
      {error ? <div className="altara-news-error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div> : null}
      {desk === 'broadcast' ? (
        <AltaraNewsBroadcastControl enabled={enabled} onNotice={onNotice} />
      ) : (
        <div className="altara-newsroom-grid">
        <aside className="altara-newsroom-directory">
          <header><div><small>EDITORIAL LEDGER</small><strong>{articles.length} ARTICLES</strong></div><button type="button" onClick={newRecord}><Plus size={14} /> NEW</button></header>
          {loading ? <span className="altara-newsroom-loading"><LoaderCircle className="altara-news-spin" /> Loading newsroom…</span> : articles.map((item) => <button key={item.articleId} type="button" data-active={article.articleId === item.articleId} onClick={() => void editArticle(item.articleId)}><span><b data-status={item.status}>{item.status}</b><small>{item.priority === 'breaking' ? 'BREAKING' : sectionLabels[item.section]}</small></span><strong>{item.headline}</strong><time>{dateLabel(item.updatedAt)}</time></button>)}
        </aside>

        <form className="altara-newsroom-editor" onSubmit={submitArticle}>
            <header className="altara-newsroom-editor__bar"><EditorHeading label="ARTICLE WORKSPACE" title={article.articleId ? 'EDIT ARTICLE' : 'NEW DRAFT'} status={articleStatus} /><button type="button" data-active={preview} onClick={() => setPreview((current) => !current)}><Eye size={14} /> {preview ? 'HIDE PREVIEW' : 'PREVIEW'}</button></header>
            <div className="altara-newsroom-workbench" data-preview={preview ? 'true' : 'false'}>
              <div className="altara-newsroom-editor__fields">
                <fieldset><legend>PUBLICATION ROUTING</legend><div className="altara-newsroom-fields two"><label>SLUG<input value={article.slug} maxLength={100} required disabled={articleStatus === 'archived'} onChange={(event) => setArticle({ ...article, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} /></label><label>SECTION<select value={article.section} disabled={articleStatus === 'archived'} onChange={(event) => setArticle({ ...article, section: event.target.value as NetAltaraNewsSection })}><option value="world">World</option><option value="business">Business</option><option value="technology">Technology</option><option value="culture">Culture</option></select></label></div><div className="altara-newsroom-fields two"><label>COVERAGE<select value={article.coverageScope} disabled={articleStatus === 'archived'} onChange={(event) => setArticle({ ...article, coverageScope: event.target.value as 'world' | 'local', locationLabel: event.target.value === 'world' ? '' : article.locationLabel })}><option value="world">World / global</option><option value="local">Local / explicit city</option></select></label><label>PRIORITY<select value={article.priority} disabled={articleStatus === 'archived'} onChange={(event) => setArticle({ ...article, priority: event.target.value as 'standard' | 'breaking' })}><option value="standard">Standard</option><option value="breaking">Breaking</option></select></label></div>{article.coverageScope === 'local' ? <label>LOCATION / CITY LABEL<input value={article.locationLabel} maxLength={120} required disabled={articleStatus === 'archived'} onChange={(event) => setArticle({ ...article, locationLabel: event.target.value })} /><small>Displayed as story origin. It never restricts who can read the article.</small></label> : null}</fieldset>
                <fieldset><legend>STORY</legend><label>HEADLINE<input value={article.headline} maxLength={180} required disabled={articleStatus === 'archived'} onChange={(event) => setArticle({ ...article, headline: event.target.value })} /></label><label>DECK<textarea value={article.deck} maxLength={400} rows={2} disabled={articleStatus === 'archived'} onChange={(event) => setArticle({ ...article, deck: event.target.value })} /></label><label>ARTICLE BODY<textarea value={article.body} maxLength={16000} rows={13} required disabled={articleStatus === 'archived'} onChange={(event) => setArticle({ ...article, body: event.target.value })} /></label></fieldset>
                <fieldset><legend>BYLINE & PRESENTATION</legend><div className="altara-newsroom-fields two"><label>AUTHOR<input value={article.authorLabel} maxLength={100} required disabled={articleStatus === 'archived'} onChange={(event) => setArticle({ ...article, authorLabel: event.target.value })} /></label><label>SOURCE<input value={article.sourceLabel} maxLength={120} disabled={articleStatus === 'archived'} onChange={(event) => setArticle({ ...article, sourceLabel: event.target.value })} /></label></div><label className="altara-newsroom-check"><input type="checkbox" checked={article.featured} disabled={articleStatus === 'archived'} onChange={(event) => setArticle({ ...article, featured: event.target.checked })} /><span><Sparkles size={14} /> FEATURE ON HOME</span></label></fieldset>
                <AltaraNewsroomMediaEditor
                  articleId={article.articleId}
                  body={article.body}
                  media={articleMedia}
                  busy={pending || articleStatus === 'archived'}
                  missingDraftFields={articleMissingFields}
                  canSaveDraft={articleCanSave}
                  onSaveDraft={persistArticle}
                  onSet={attachArticleMedia}
                  onRequestRemove={setMediaToRemove}
                  onNotice={onNotice}
                />
                {mediaToRemove ? <div className="altara-newsroom-confirm altara-newsroom-media-confirm" role="alertdialog" aria-label="Confirm media removal"><AlertTriangle size={16} /><span><strong>REMOVE THIS IMAGE?</strong><small>The article reference is removed. Private immutable object deletion is intentionally separate.</small></span><button type="button" className="danger" disabled={pending} onClick={removeArticleMedia}>REMOVE</button><button type="button" disabled={pending} onClick={() => setMediaToRemove(null)}><X size={14} /> CANCEL</button></div> : null}
              </div>
              {preview ? <ArticleDraftPreview article={article} media={articleMedia} /> : null}
            </div>
            <footer className="altara-newsroom-actions">
              {confirmArticleAction ? <div className="altara-newsroom-confirm" role="alertdialog" aria-label={`Confirm ${confirmArticleAction}`}><AlertTriangle size={16} /><span><strong>{confirmArticleAction === 'archive' ? 'ARCHIVE THIS ARTICLE?' : 'REMOVE FROM PUBLIC EDITION?'}</strong><small>{confirmArticleAction === 'archive' ? 'The record remains in newsroom history.' : 'The article returns to draft and disappears from player feeds.'}</small></span><button type="button" className="danger" disabled={pending} onClick={() => articleLifecycle(confirmArticleAction)}>CONFIRM</button><button type="button" disabled={pending} onClick={() => setConfirmArticleAction(null)}><X size={14} /> CANCEL</button></div> : <><button type="submit" disabled={pending || articleStatus === 'archived'}><Save size={14} /> SAVE</button>{article.articleId && articleStatus === 'draft' ? <button type="button" disabled={pending} onClick={() => articleLifecycle('publish')}><Check size={14} /> PUBLISH NOW</button> : null}{article.articleId && articleStatus === 'published' ? <button type="button" disabled={pending} onClick={() => setConfirmArticleAction('unpublish')}>UNPUBLISH</button> : null}{article.articleId && articleStatus !== 'archived' ? <button type="button" className="danger" disabled={pending} onClick={() => setConfirmArticleAction('archive')}><Archive size={14} /> ARCHIVE</button> : null}{article.articleId && articleStatus === 'archived' ? <button type="button" disabled={pending} onClick={() => articleLifecycle('restore')}><RefreshCw size={14} /> RESTORE</button> : null}</>}
            </footer>
          </form>
        </div>
      )}
      {confirmDiscard ? (
        <NewsPlatformConfirmation
          className="altara-newsroom-dialog-backdrop"
          dialogClassName="altara-newsroom-dialog"
          title="Discard unsaved newsroom changes?"
          body="Changing desks or records will discard local editorial changes that have not been saved."
          confirmLabel="Discard and continue"
          tone="danger"
          onCancel={() => { transitionRef.current = null; setConfirmDiscard(false) }}
          onConfirm={() => {
            const transition = transitionRef.current
            transitionRef.current = null
            setConfirmDiscard(false)
            transition?.()
          }}
        />
      ) : null}
    </section>
  )
}

function AltaraNewsEmpty({ icon, title, copy }: { readonly icon: ReactNode; readonly title: string; readonly copy: string }) {
  return <div className="altara-news-empty">{icon}<strong>{title}</strong><p>{copy}</p></div>
}

function AltaraNewsState({ icon, title, copy }: { readonly icon: ReactNode; readonly title: string; readonly copy: string }) {
  return <div className="altara-news altara-news-state">{icon}<strong>{title}</strong><p>{copy}</p></div>
}

export function AltaraNewsApp(props: AltaraNewsAppProps) {
  if (props.mode === 'newsroom') return <AltaraNewsroom enabled={props.enabled} onNotice={props.onNotice} />
  return <AltaraNewsReader {...props} />
}
