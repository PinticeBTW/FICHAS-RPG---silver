import { Copy, Search, X } from 'lucide-react'

import {
  NET_NVN_SEARCH_MAX_LENGTH,
  type NetNvnArticleSummary,
  type NetNvnCategory,
} from '../../lib/netNvnTypes'
import { NvnReaderFeedback, NvnRefreshStrip } from './NvnReaderFeedback'
import {
  NVN_CATEGORY_LABELS,
  NVN_STORY_KIND_LABELS,
  formatNvnDate,
  netNvnArticleReference,
} from './nvnPresentation'

interface NvnArchiveProps {
  articles: readonly NetNvnArticleSummary[]
  searchInput: string
  category?: NetNvnCategory
  searchTooShort: boolean
  searchSettling: boolean
  loading: boolean
  refreshing: boolean
  loadingMore: boolean
  hasMore: boolean
  error?: string
  onSearchChange: (value: string) => void
  onCategoryChange: (category?: NetNvnCategory) => void
  onOpenArticle: (id: string) => void
  onLoadMore: () => void
  onRetry: () => void
  onNotice: (message: string) => void
}

export function NvnArchive({
  articles,
  searchInput,
  category,
  searchTooShort,
  searchSettling,
  loading,
  refreshing,
  loadingMore,
  hasMore,
  error,
  onSearchChange,
  onCategoryChange,
  onOpenArticle,
  onLoadMore,
  onRetry,
  onNotice,
}: NvnArchiveProps) {
  const handleCopyReference = async (article: NetNvnArticleSummary) => {
    try {
      if (!navigator.clipboard?.writeText) {
        onNotice('NVN // CLIPBOARD UNAVAILABLE')
        return
      }
      await navigator.clipboard.writeText(netNvnArticleReference(article.slug))
      onNotice('NVN // ARCHIVE REFERENCE COPIED')
    } catch {
      onNotice('NVN // COPY FAILED')
    }
  }

  return (
    <div className="nvn-archive">
      <header className="nvn-archive__head">
        <h2>Archive</h2>

        <div className="nvn-search">
          <Search size={14} aria-hidden="true" />
          <input
            value={searchInput}
            onChange={(event) => onSearchChange(event.target.value)}
            maxLength={NET_NVN_SEARCH_MAX_LENGTH}
            placeholder="Search archived reports"
            aria-label="Search the NVN archive"
          />
          {searchInput ? (
            <button type="button" onClick={() => onSearchChange('')} aria-label="Clear archive search">
              <X size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="nvn-archive__filters">
        <label>
          <span>Desk</span>
          <select
            value={category ?? 'all'}
            onChange={(event) => {
              const value = event.target.value
              onCategoryChange(value === 'all' ? undefined : value as NetNvnCategory)
            }}
          >
            <option value="all">All categories</option>
            {Object.entries(NVN_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {refreshing || searchSettling ? (
        <NvnRefreshStrip message={searchSettling ? 'Preparing archive search…' : 'Syncing archive…'} />
      ) : null}
      {error && articles.length > 0 ? (
        <NvnRefreshStrip message={error} error onRetry={onRetry} />
      ) : null}

      {searchTooShort ? (
        <NvnReaderFeedback
          title="Search needs more signal"
          detail="Enter at least three characters to search the archive."
        />
      ) : loading ? (
        <NvnReaderFeedback
          title="Syncing archive"
          detail="Retrieving the bounded historical newsroom index."
          loading
        />
      ) : error && articles.length === 0 ? (
        <NvnReaderFeedback title="Archive unavailable" detail={error} error onRetry={onRetry} />
      ) : articles.length === 0 ? (
        <NvnReaderFeedback
          title={searchInput.trim() ? 'No archived stories found' : 'Archive empty'}
          detail={
            searchInput.trim()
              ? 'No archived reports match this search and category.'
              : 'The NVN historical record does not contain any archived reports yet.'
          }
        />
      ) : (
        <div className="nvn-archive__results">
          {articles.map((article) => (
            <div key={article.id} className="nvn-archive-row">
              <button
                type="button"
                className="nvn-archive-row__main"
                onClick={() => onOpenArticle(article.id)}
              >
                <time className="nvn-archive-row__year" dateTime={article.archivedAt}>
                  {article.archivedAt ? formatNvnDate(article.archivedAt) : 'ARCHIVED'}
                </time>
                <span className="nvn-archive-row__body">
                  <strong>{article.headline}</strong>
                  <small>
                    {article.bylineName} · {NVN_CATEGORY_LABELS[article.category]}
                    {article.districtLabel ? ` · ${article.districtLabel}` : ''}
                  </small>
                </span>
                <span className="nvn-archive-row__type">
                  {NVN_STORY_KIND_LABELS[article.storyKind]}
                </span>
                <span className="nvn-archive-row__status">Archived</span>
              </button>

              <div className="nvn-archive-row__actions">
                <button
                  type="button"
                  onClick={() => handleCopyReference(article)}
                  aria-label={`Copy reference for ${article.headline}`}
                  title="Copy reference"
                >
                  <Copy size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasMore && articles.length > 0 ? (
        <button
          type="button"
          className="nvn-load-more"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading archive page…' : 'Load more'}
        </button>
      ) : null}
    </div>
  )
}
