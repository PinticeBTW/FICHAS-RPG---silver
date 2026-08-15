import type { NetNvnArticleDetail } from '../../lib/netNvnTypes'
import { NewsPlatformArticleReader } from './news/NewsPlatformArticleReader'
import { adaptNvnArticleDetail } from './news/nvnNewsPlatformAdapter'
import { NvnArticleBody, NvnArticleHero } from './NvnArticleMedia'
import { netNvnArticleReference } from './nvnPresentation'

export function NvnArticleView({
  article,
  onBack,
  onNotice,
}: {
  readonly article: NetNvnArticleDetail
  readonly onBack: () => void
  readonly onNotice: (message: string) => void
}) {
  const copyReference = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        onNotice('NVN // CLIPBOARD UNAVAILABLE')
        return
      }
      await navigator.clipboard.writeText(netNvnArticleReference(article.slug))
      onNotice('NVN // STORY REFERENCE COPIED')
    } catch {
      onNotice('NVN // COPY FAILED')
    }
  }
  return (
    <NewsPlatformArticleReader
      classNamePrefix="nvn"
      article={adaptNvnArticleDetail(article)}
      hero={<NvnArticleHero media={article.media} />}
      body={<NvnArticleBody body={article.body} media={article.media} />}
      referenceLabel="Linked public-grid reference"
      onBack={onBack}
      onCopyReference={() => void copyReference()}
    />
  )
}
