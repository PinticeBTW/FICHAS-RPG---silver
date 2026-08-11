import { Radio } from 'lucide-react'

import type { NetNvnArticleSummary } from '../../lib/netNvnTypes'
import { formatNvnRelativeTime } from './nvnPresentation'
import type { NvnRadioController } from './useNetNvnRadio'

interface NvnRightRailProps {
  articles: readonly NetNvnArticleSummary[]
  onOpenArticle: (id: string) => void
  onOpenLive: () => void
  radio: NvnRadioController
}

function RailList({
  articles,
  onOpenArticle,
}: {
  articles: readonly NetNvnArticleSummary[]
  onOpenArticle: (id: string) => void
}) {
  return (
    <div className="nvn-widget__list">
      {articles.map((article) => (
        <button key={article.id} type="button" onClick={() => onOpenArticle(article.id)}>
          <span>{article.shortHeadline ?? article.headline}</span>
          <time dateTime={article.publishedAt}>{formatNvnRelativeTime(article.publishedAt)}</time>
        </button>
      ))}
    </div>
  )
}

export function NvnRightRail({ articles, onOpenArticle, onOpenLive, radio }: NvnRightRailProps) {
  const breaking = articles.filter((article) => article.priority === 'breaking').slice(0, 3)
  const latest = articles.slice(0, 5)
  const investigations = articles
    .filter((article) => article.storyKind === 'investigation')
    .slice(0, 4)

  return (
    <aside className="nvn-rail" aria-label="NVN newsroom index">
      {breaking.length > 0 ? (
        <section className="nvn-widget nvn-widget--breaking">
          <h3>Breaking</h3>
          <RailList articles={breaking} onOpenArticle={onOpenArticle} />
        </section>
      ) : null}

      <section className="nvn-widget">
        <h3>Latest headlines</h3>
        {latest.length > 0 ? (
          <RailList articles={latest} onOpenArticle={onOpenArticle} />
        ) : (
          <p className="nvn-widget__empty">No published headlines on the current desk.</p>
        )}
      </section>

      {investigations.length > 0 ? (
        <section className="nvn-widget">
          <h3>Investigations</h3>
          <RailList articles={investigations} onOpenArticle={onOpenArticle} />
        </section>
      ) : null}

      <section className="nvn-widget nvn-widget--live-status">
        <h3 data-breaking={radio.tuneState?.mode === 'breaking' ? 'true' : undefined}>
          <Radio size={13} aria-hidden="true" /> NVN Live
        </h3>
        <p>
          {radio.tuneState?.stationStatus === 'on-air'
            ? radio.tuneState.mode === 'breaking'
              ? 'BREAKING NEWS is live on the citywide carrier.'
              : radio.tuneState.current?.publicLabel ?? 'The City News Network is on air.'
            : 'The citywide LIVE broadcast is currently off air.'}
        </p>
        <small>Broadcast tuner and authoritative incident ledger.</small>
        <button type="button" onClick={onOpenLive}>Open LIVE</button>
      </section>
    </aside>
  )
}
