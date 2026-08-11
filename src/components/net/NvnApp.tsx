import { ArrowLeft, Search, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { NET_NVN_SEARCH_MAX_LENGTH } from '../../lib/netNvnTypes'
import '../../styles/nvn.css'

import { getNetAppDefinition, type NetAppAccessMode } from './netAppCatalog'
import { NvnArchive } from './NvnArchive'
import { NvnArticleView } from './NvnArticleView'
import { NvnHome } from './NvnHome'
import { NvnLiveDesk } from './NvnLiveDesk'
import { NvnNewsroomConfirmation, NvnNewsroomControl } from './NvnNewsroomControl'
import { NvnReaderFeedback, NvnRefreshStrip } from './NvnReaderFeedback'
import { NvnRightRail } from './NvnRightRail'
import { NvnSidebar } from './NvnSidebar'
import { NvnUnifiedLiveControl } from './NvnUnifiedLiveControl'
import {
  NVN_CATEGORY_LABELS,
  formatNvnRelativeTime,
} from './nvnPresentation'
import { useNetNvnReader, type NvnReaderNav } from './useNetNvnReader'
import { useNetNvnRealtime } from './useNetNvnRealtime'
import { useNetNvnRadio } from './useNetNvnRadio'

type NvnWorkspace = 'newsroom' | 'live-control' | 'reader'

interface NvnAppProps {
  onNotice: (message: string) => void
  accessMode: NetAppAccessMode
  isWindowOpen: boolean
  onOpenApp?: (appId: string) => void
}

const NVN_GM_DEFAULT_WORKSPACE =
  getNetAppDefinition('nvn')?.gmSystemAccess?.entryPoint === 'newsroom-control'
    ? 'newsroom'
    : 'reader'

export function NvnApp({ onNotice, accessMode, isWindowOpen }: NvnAppProps) {
  const isGmSystemAccess = accessMode === 'gm-system'
  const [gmWorkspace, setGmWorkspace] = useState<NvnWorkspace>(NVN_GM_DEFAULT_WORKSPACE)
  const [newsroomDirty, setNewsroomDirty] = useState(false)
  const [liveControlDirty, setLiveControlDirty] = useState(false)
  const [requestedDestination, setRequestedDestination] = useState<{
    readonly workspace: NvnWorkspace
    readonly nav?: NvnReaderNav
  } | null>(null)
  const isNewsroomControl = isGmSystemAccess && gmWorkspace === 'newsroom'
  const isLiveControl = isGmSystemAccess && gmWorkspace === 'live-control'
  const isAnyGmControl = isNewsroomControl || isLiveControl
  const activeControlDirty = isNewsroomControl
    ? newsroomDirty
    : isLiveControl
      ? liveControlDirty
      : false
  const realtime = useNetNvnRealtime(isWindowOpen)
  const radio = useNetNvnRadio(isWindowOpen, realtime.radioInvalidationVersion)
  const reader = useNetNvnReader(
    isWindowOpen && !isAnyGmControl,
    realtime.articleInvalidationVersion,
  )
  const pageLoading = reader.pageStatus !== 'ready' && !reader.pageError
  const isSearchView =
    reader.nav !== 'archive'
    && reader.nav !== 'live'
    && reader.searchInput.trim().length > 0

  let centerContent: ReactNode

  if (reader.selectedArticleId) {
    if (reader.detailStatus === 'ready' && reader.detail) {
      centerContent = (
        <>
          {reader.detailRefreshing ? (
            <NvnRefreshStrip message="Synchronizing this newsroom record…" />
          ) : null}
          {reader.detailError ? (
            <NvnRefreshStrip
              message={reader.detailError}
              error
              onRetry={reader.retryDetail}
            />
          ) : null}
          <NvnArticleView
            key={reader.detail.id}
            article={reader.detail}
            onBack={reader.goBack}
            onNotice={onNotice}
          />
        </>
      )
    } else {
      centerContent = (
        <div className="nvn-detail-state">
          <button type="button" className="nvn-back" onClick={reader.goBack}>
            <ArrowLeft size={14} aria-hidden="true" />
            Back
          </button>
          {reader.detailStatus === 'loading' ? (
            <NvnReaderFeedback
              title="Opening newsroom record"
              detail="Retrieving the published article body."
              loading
            />
          ) : reader.detailStatus === 'unavailable' ? (
            <NvnReaderFeedback
              title="Story unavailable"
              detail="This newsroom record is no longer available to readers."
            />
          ) : (
            <NvnReaderFeedback
              title="Story could not be opened"
              detail={reader.detailError ?? 'The article body could not be retrieved.'}
              error
              onRetry={reader.retryDetail}
            />
          )}
        </div>
      )
    }
  } else if (reader.nav === 'live') {
    centerContent = (
      <NvnLiveDesk
        enabled={isWindowOpen && !isAnyGmControl}
        realtimeInvalidationVersion={realtime.liveInvalidationVersion}
        radio={radio}
      />
    )
  } else if (reader.nav === 'archive') {
    centerContent = (
      <NvnArchive
        articles={reader.articles}
        searchInput={reader.searchInput}
        category={reader.archiveCategory}
        searchTooShort={reader.searchTooShort}
        searchSettling={reader.searchSettling}
        loading={pageLoading}
        refreshing={reader.refreshing}
        loadingMore={reader.loadingMore}
        hasMore={reader.hasMore}
        error={reader.pageError}
        onSearchChange={reader.setSearchInput}
        onCategoryChange={reader.setArchiveCategory}
        onOpenArticle={reader.openArticle}
        onLoadMore={reader.loadMore}
        onRetry={reader.retryPage}
        onNotice={onNotice}
      />
    )
  } else if (isSearchView) {
    const query = reader.settledSearch || reader.searchInput.trim()
    centerContent = (
      <div className="nvn-search-results">
        <header className="nvn-home__header">
          <h2>Search</h2>
          <button
            type="button"
            className="nvn-clear-filters"
            onClick={() => reader.setSearchInput('')}
          >
            <X size={13} aria-hidden="true" /> Clear search
          </button>
        </header>

        {reader.searchSettling ? (
          <NvnReaderFeedback
            title="Preparing search"
            detail="Waiting for the newsroom query to settle."
            loading
          />
        ) : reader.searchTooShort ? (
          <NvnReaderFeedback
            title="Search needs more signal"
            detail="Enter at least three characters to search published stories."
          />
        ) : pageLoading ? (
          <NvnReaderFeedback
            title={`Searching for “${query}”`}
            detail="Scanning the bounded published newsroom index."
            loading
          />
        ) : reader.pageError && reader.articles.length === 0 ? (
          <NvnReaderFeedback
            title="Search unavailable"
            detail={reader.pageError}
            error
            onRetry={reader.retryPage}
          />
        ) : reader.articles.length === 0 ? (
          <NvnReaderFeedback
            title="No stories found"
            detail={`No published NVN stories match “${query}”.`}
          />
        ) : (
          <>
            {reader.refreshing ? <NvnRefreshStrip message="Refreshing search results…" /> : null}
            {reader.pageError ? (
              <NvnRefreshStrip message={reader.pageError} error onRetry={reader.retryPage} />
            ) : null}
            <p className="nvn-search-results__scope">
              Results for “{query}”
              {reader.nav !== 'top' ? ` · ${NVN_CATEGORY_LABELS[reader.nav]}` : ''}
            </p>
            <div className="nvn-compact-list nvn-compact-list--search">
              {reader.articles.map((article) => (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => reader.openArticle(article.id)}
                >
                  <span className="nvn-category-tag">
                    {NVN_CATEGORY_LABELS[article.category]}
                  </span>
                  <span>{article.headline}</span>
                  <time dateTime={article.publishedAt}>
                    {formatNvnRelativeTime(article.publishedAt)}
                  </time>
                </button>
              ))}
            </div>
            {reader.hasMore ? (
              <button
                type="button"
                className="nvn-load-more"
                onClick={reader.loadMore}
                disabled={reader.loadingMore}
              >
                {reader.loadingMore ? 'Loading search page…' : 'Load more'}
              </button>
            ) : null}
          </>
        )}
      </div>
    )
  } else if (pageLoading) {
    centerContent = (
      <NvnReaderFeedback
        title="Syncing newsroom"
        detail="Retrieving the latest published NVN record."
        loading
      />
    )
  } else if (reader.pageError && reader.articles.length === 0) {
    centerContent = (
      <NvnReaderFeedback
        title="Newsroom unavailable"
        detail={reader.pageError}
        error
        onRetry={reader.retryPage}
      />
    )
  } else if (reader.articles.length === 0) {
    centerContent = (
      <NvnReaderFeedback
        title={reader.nav === 'top' ? 'No stories published' : 'No stories in this desk'}
        detail={
          reader.nav === 'top'
            ? 'The NVN newsroom has no active reports on the public grid.'
            : `${NVN_CATEGORY_LABELS[reader.nav]} has no published reports yet.`
        }
      />
    )
  } else {
    centerContent = (
      <>
        {reader.refreshing ? <NvnRefreshStrip message="Syncing newsroom index…" /> : null}
        {reader.pageError ? (
          <NvnRefreshStrip message={reader.pageError} error onRetry={reader.retryPage} />
        ) : null}
        <NvnHome
          mode={reader.nav}
          articles={reader.articles}
          hasMore={reader.hasMore}
          loadingMore={reader.loadingMore}
          onOpenArticle={reader.openArticle}
          onLoadMore={reader.loadMore}
        />
      </>
    )
  }

  const showSearch =
    !reader.selectedArticleId && reader.nav !== 'live' && reader.nav !== 'archive'

  const openReader = (nav: NvnReaderNav) => {
    if (isAnyGmControl && activeControlDirty) {
      setRequestedDestination({ workspace: 'reader', nav })
      return
    }
    setGmWorkspace('reader')
    reader.setNav(nav)
  }

  const openGmWorkspace = (workspace: Exclude<NvnWorkspace, 'reader'>) => {
    if (gmWorkspace === workspace) return
    if (isAnyGmControl && activeControlDirty) {
      setRequestedDestination({ workspace })
      return
    }
    setGmWorkspace(workspace)
  }

  return (
    <div className="nvn-app">
      <NvnSidebar
        accessMode={accessMode}
        realtimeStatus={realtime.connectionStatus}
        nav={reader.nav}
        isNewsroomControl={isNewsroomControl}
        isLiveControl={isLiveControl}
        onOpenNewsroom={() => openGmWorkspace('newsroom')}
        onOpenLiveControl={() => openGmWorkspace('live-control')}
        onNavChange={openReader}
      />

      {isNewsroomControl ? (
        <NvnNewsroomControl
          enabled={isWindowOpen}
          realtimeInvalidationVersion={realtime.invalidationVersion}
          beginLocalMutation={realtime.beginLocalMutation}
          onDirtyChange={setNewsroomDirty}
          onPublicContentChanged={reader.invalidate}
          onNotice={onNotice}
        />
      ) : isLiveControl ? (
        <NvnUnifiedLiveControl
          enabled={isWindowOpen}
          liveRealtimeInvalidationVersion={realtime.liveInvalidationVersion}
          radioRealtimeInvalidationVersion={realtime.radioInvalidationVersion}
          beginLiveMutation={() => realtime.beginLocalMutation('live')}
          beginRadioMutation={() => realtime.beginLocalMutation('radio')}
          onDirtyChange={setLiveControlDirty}
          onNotice={onNotice}
          onRadioStateChanged={radio.resynchronize}
        />
      ) : (
        <>
          <main className="nvn-center" aria-busy={pageLoading ? 'true' : undefined}>
        {showSearch ? (
          <div className="nvn-search">
            <Search size={14} aria-hidden="true" />
            <input
              value={reader.searchInput}
              onChange={(event) => reader.setSearchInput(event.target.value)}
              maxLength={NET_NVN_SEARCH_MAX_LENGTH}
              placeholder="Search headlines, bylines, tags, districts"
              aria-label="Search published NVN stories"
            />
            {reader.searchInput ? (
              <button type="button" onClick={() => reader.setSearchInput('')} aria-label="Clear search">
                <X size={13} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}

            {centerContent}
          </main>

          <div className="nvn-rail-wrap">
            <NvnRightRail
              articles={reader.articles}
              onOpenArticle={reader.openArticle}
              onOpenLive={() => reader.setNav('live')}
              radio={radio}
            />
          </div>
        </>
      )}

      {requestedDestination ? (
        <NvnNewsroomConfirmation
          title={isLiveControl ? 'Leave unsaved LIVE changes?' : 'Leave unsaved article?'}
          body="Changing NVN workspaces will discard local editorial changes that have not been saved."
          confirmLabel="Discard and continue"
          tone="danger"
          onCancel={() => setRequestedDestination(null)}
          onConfirm={() => {
            const destination = requestedDestination
            setRequestedDestination(null)
            setGmWorkspace(destination.workspace)
            if (destination.workspace === 'reader') reader.setNav(destination.nav ?? 'top')
          }}
        />
      ) : null}
    </div>
  )
}
