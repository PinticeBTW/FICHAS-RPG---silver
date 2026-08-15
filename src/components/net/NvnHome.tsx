import type { NetNvnArticleSummary, NetNvnCategory } from '../../lib/netNvnTypes'
import { NewsPlatformHome } from './news/NewsPlatformHome'
import { adaptNvnArticleSummary } from './news/nvnNewsPlatformAdapter'
import { NVN_CATEGORY_LABELS } from './nvnPresentation'

export function NvnHome({
  mode,
  articles,
  hasMore,
  loadingMore,
  onOpenArticle,
  onLoadMore,
}: {
  readonly mode: 'top' | NetNvnCategory
  readonly articles: readonly NetNvnArticleSummary[]
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly onOpenArticle: (id: string) => void
  readonly onLoadMore: () => void
}) {
  return (
    <NewsPlatformHome
      classNamePrefix="nvn"
      heading={mode === 'top' ? 'Top Stories' : NVN_CATEGORY_LABELS[mode]}
      scopeLabel={mode === 'top' ? 'Published newsroom record' : `${NVN_CATEGORY_LABELS[mode]} desk`}
      articles={articles.map(adaptNvnArticleSummary)}
      hasMore={hasMore}
      loadingMore={loadingMore}
      showCategoryBadge={false}
      showLocation={false}
      onOpenArticle={onOpenArticle}
      onLoadMore={onLoadMore}
    />
  )
}
