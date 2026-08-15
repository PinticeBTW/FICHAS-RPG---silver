import type { NetNvnArticleSummary, NetNvnCategory } from '../../lib/netNvnTypes'
import { NewsPlatformArchive } from './news/NewsPlatformArchive'
import { adaptNvnArticleSummary } from './news/nvnNewsPlatformAdapter'
import { netNvnArticleReference, NVN_CATEGORY_LABELS } from './nvnPresentation'

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
}: {
  readonly articles: readonly NetNvnArticleSummary[]
  readonly searchInput: string
  readonly category?: NetNvnCategory
  readonly searchTooShort: boolean
  readonly searchSettling: boolean
  readonly loading: boolean
  readonly refreshing: boolean
  readonly loadingMore: boolean
  readonly hasMore: boolean
  readonly error?: string
  readonly onSearchChange: (value: string) => void
  readonly onCategoryChange: (category?: NetNvnCategory) => void
  readonly onOpenArticle: (id: string) => void
  readonly onLoadMore: () => void
  readonly onRetry: () => void
  readonly onNotice: (message: string) => void
}) {
  return (
    <NewsPlatformArchive
      classNamePrefix="nvn"
      productName="NVN"
      articles={articles.map(adaptNvnArticleSummary)}
      searchInput={searchInput}
      category={category}
      categories={NVN_CATEGORY_LABELS}
      searchTooShort={searchTooShort}
      searchSettling={searchSettling}
      loading={loading}
      refreshing={refreshing}
      loadingMore={loadingMore}
      hasMore={hasMore}
      error={error}
      onSearchChange={onSearchChange}
      onCategoryChange={(value) => onCategoryChange(value as NetNvnCategory | undefined)}
      onOpenArticle={onOpenArticle}
      onLoadMore={onLoadMore}
      onRetry={onRetry}
      onCopyReference={async (article) => {
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
      }}
    />
  )
}
