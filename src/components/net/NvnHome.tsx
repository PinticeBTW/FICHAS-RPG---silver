import { Clock } from 'lucide-react'
import { useMemo } from 'react'

import type { NetNvnArticleSummary, NetNvnCategory } from '../../lib/netNvnTypes'
import {
  NVN_CATEGORY_LABELS,
  NVN_STORY_KIND_LABELS,
  formatNvnRelativeTime,
} from './nvnPresentation'

function StoryFlags({ article }: { article: NetNvnArticleSummary }) {
  return (
    <div className="nvn-story-flags">
      {article.priority === 'breaking' ? (
        <em className="nvn-flag nvn-flag--breaking">Breaking</em>
      ) : null}
      {article.storyKind !== 'report' ? (
        <em className="nvn-flag">{NVN_STORY_KIND_LABELS[article.storyKind]}</em>
      ) : null}
    </div>
  )
}

function StoryMeta({ article }: { article: NetNvnArticleSummary }) {
  return (
    <div className="nvn-story-meta">
      <span className="nvn-story-author">{article.bylineName}</span>
      <span>
        <Clock size={11} aria-hidden="true" />
        {formatNvnRelativeTime(article.publishedAt)}
      </span>
    </div>
  )
}

interface NvnHomeProps {
  mode: 'top' | NetNvnCategory
  articles: readonly NetNvnArticleSummary[]
  hasMore: boolean
  loadingMore: boolean
  onOpenArticle: (id: string) => void
  onLoadMore: () => void
}

export function NvnHome({
  mode,
  articles,
  hasMore,
  loadingMore,
  onOpenArticle,
  onLoadMore,
}: NvnHomeProps) {
  const isTop = mode === 'top'
  const lead = articles.find((article) => article.priority === 'breaking') ?? articles[0]
  const secondary = articles.filter((article) => article.id !== lead?.id).slice(0, 4)
  const latest = articles.slice(0, 7)
  const investigations = useMemo(
    () => articles.filter((article) => article.storyKind === 'investigation').slice(0, 4),
    [articles],
  )

  if (!lead) return null

  return (
    <div className="nvn-home">
      <header className="nvn-home__header">
        <h2>{isTop ? 'Top Stories' : NVN_CATEGORY_LABELS[mode]}</h2>
        <span className="nvn-result-scope">
          {isTop ? 'Published newsroom record' : `${NVN_CATEGORY_LABELS[mode]} desk`}
        </span>
      </header>

      <button
        type="button"
        className="nvn-lead"
        data-breaking={lead.priority === 'breaking' ? 'true' : 'false'}
        onClick={() => onOpenArticle(lead.id)}
      >
        <div className="nvn-lead__body">
          <StoryFlags article={lead} />
          <h1>{lead.headline}</h1>
          {lead.summary ? <p>{lead.summary}</p> : null}
          <StoryMeta article={lead} />
        </div>
      </button>

      {secondary.length > 0 ? (
        <div className="nvn-secondary-grid">
          {secondary.map((article) => (
            <button
              key={article.id}
              type="button"
              className="nvn-story-card"
              onClick={() => onOpenArticle(article.id)}
            >
              <StoryFlags article={article} />
              <strong>{article.shortHeadline ?? article.headline}</strong>
              <StoryMeta article={article} />
            </button>
          ))}
        </div>
      ) : null}

      <div className={`nvn-home__columns${investigations.length ? '' : ' nvn-home__columns--single'}`}>
        <section className="nvn-section">
          <h3>Latest</h3>
          <div className="nvn-compact-list">
            {latest.map((article) => (
              <button key={article.id} type="button" onClick={() => onOpenArticle(article.id)}>
                <span>{article.shortHeadline ?? article.headline}</span>
                <time dateTime={article.publishedAt}>{formatNvnRelativeTime(article.publishedAt)}</time>
              </button>
            ))}
          </div>
        </section>

        {investigations.length > 0 ? (
          <section className="nvn-section">
            <h3>Investigations</h3>
            <div className="nvn-compact-list">
              {investigations.map((article) => (
                <button key={article.id} type="button" onClick={() => onOpenArticle(article.id)}>
                  <span>{article.shortHeadline ?? article.headline}</span>
                  <time dateTime={article.publishedAt}>
                    {formatNvnRelativeTime(article.publishedAt)}
                  </time>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {hasMore ? (
        <button
          type="button"
          className="nvn-load-more"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading newsroom page…' : 'Load more'}
        </button>
      ) : null}
    </div>
  )
}
