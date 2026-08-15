import { Copy, Search, X } from 'lucide-react'

import type { NewsPlatformArticleSummary } from '../../../lib/newsPlatformTypes'
import { NewsPlatformFeedback, NewsPlatformRefreshStrip } from './NewsPlatformFeedback'
import { formatNewsPlatformDate } from './newsPlatformPresentation'

function classes(prefix: string, token: string) {
  return `${prefix}-${token}`
}

export function NewsPlatformArchive({
  classNamePrefix,
  productName,
  articles,
  searchInput,
  category,
  categories,
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
  onCopyReference,
}: {
  readonly classNamePrefix: string
  readonly productName: string
  readonly articles: readonly NewsPlatformArticleSummary[]
  readonly searchInput: string
  readonly category?: string
  readonly categories: Readonly<Record<string, string>>
  readonly searchTooShort: boolean
  readonly searchSettling: boolean
  readonly loading: boolean
  readonly refreshing: boolean
  readonly loadingMore: boolean
  readonly hasMore: boolean
  readonly error?: string
  readonly onSearchChange: (value: string) => void
  readonly onCategoryChange: (category?: string) => void
  readonly onOpenArticle: (id: string) => void
  readonly onLoadMore: () => void
  readonly onRetry: () => void
  readonly onCopyReference: (article: NewsPlatformArticleSummary) => void
}) {
  return (
    <div className={classes(classNamePrefix, 'archive')}>
      <header className={classes(classNamePrefix, 'archive__head')}>
        <h2>Archive</h2>
        <div className={classes(classNamePrefix, 'search')}>
          <Search size={14} aria-hidden="true" />
          <input value={searchInput} onChange={(event) => onSearchChange(event.target.value)} maxLength={80} placeholder="Search archived reports" aria-label={`Search the ${productName} archive`} />
          {searchInput ? <button type="button" onClick={() => onSearchChange('')} aria-label="Clear archive search"><X size={13} aria-hidden="true" /></button> : null}
        </div>
      </header>
      <div className={classes(classNamePrefix, 'archive__filters')}>
        <label><span>Desk</span><select value={category ?? 'all'} onChange={(event) => onCategoryChange(event.target.value === 'all' ? undefined : event.target.value)}><option value="all">All categories</option>{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>

      {refreshing || searchSettling ? <NewsPlatformRefreshStrip classNamePrefix={classNamePrefix} message={searchSettling ? 'Preparing archive search…' : 'Syncing archive…'} /> : null}
      {error && articles.length > 0 ? <NewsPlatformRefreshStrip classNamePrefix={classNamePrefix} message={error} error onRetry={onRetry} /> : null}
      {searchTooShort ? (
        <NewsPlatformFeedback classNamePrefix={classNamePrefix} title="Search needs more signal" detail="Enter at least three characters to search the archive." />
      ) : loading ? (
        <NewsPlatformFeedback classNamePrefix={classNamePrefix} title="Syncing archive" detail="Retrieving the bounded historical newsroom index." loading />
      ) : error && articles.length === 0 ? (
        <NewsPlatformFeedback classNamePrefix={classNamePrefix} title="Archive unavailable" detail={error} error onRetry={onRetry} />
      ) : articles.length === 0 ? (
        <NewsPlatformFeedback classNamePrefix={classNamePrefix} title={searchInput.trim() ? 'No archived stories found' : 'Archive empty'} detail={searchInput.trim() ? 'No archived reports match this search and category.' : `${productName} has no archived reports yet.`} />
      ) : (
        <div className={classes(classNamePrefix, 'archive__results')}>
          {articles.map((article) => (
            <div key={article.id} className={classes(classNamePrefix, 'archive-row')}>
              <button type="button" className={classes(classNamePrefix, 'archive-row__main')} onClick={() => onOpenArticle(article.id)}>
                <time className={classes(classNamePrefix, 'archive-row__year')} dateTime={article.archivedAt}>{article.archivedAt ? formatNewsPlatformDate(article.archivedAt) : 'ARCHIVED'}</time>
                <span className={classes(classNamePrefix, 'archive-row__body')}><strong>{article.headline}</strong><small>{article.bylineName} · {article.categoryLabel}{article.locationLabel ? ` · ${article.locationLabel}` : ''}</small></span>
                <span className={classes(classNamePrefix, 'archive-row__type')}>{article.storyKindLabel ?? article.categoryLabel}</span>
                <span className={classes(classNamePrefix, 'archive-row__status')}>Archived</span>
              </button>
              <div className={classes(classNamePrefix, 'archive-row__actions')}><button type="button" onClick={() => onCopyReference(article)} aria-label={`Copy reference for ${article.headline}`} title="Copy reference"><Copy size={14} aria-hidden="true" /></button></div>
            </div>
          ))}
        </div>
      )}
      {hasMore && articles.length > 0 ? <button type="button" className={classes(classNamePrefix, 'load-more')} onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? 'Loading archive page…' : 'Load more'}</button> : null}
    </div>
  )
}
