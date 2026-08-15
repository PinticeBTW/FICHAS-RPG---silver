import { Clock, MapPin } from 'lucide-react'
import { useMemo } from 'react'

import type { NewsPlatformArticleSummary } from '../../../lib/newsPlatformTypes'
import { formatNewsPlatformRelativeTime } from './newsPlatformPresentation'

function classes(prefix: string, token: string) {
  return `${prefix}-${token}`
}

function StoryFlags({
  article,
  classNamePrefix,
}: {
  readonly article: NewsPlatformArticleSummary
  readonly classNamePrefix: string
}) {
  return (
    <div className={classes(classNamePrefix, 'story-flags')}>
      {article.priority === 'breaking' ? (
        <em className={`${classes(classNamePrefix, 'flag')} ${classes(classNamePrefix, 'flag--breaking')}`}>
          Breaking
        </em>
      ) : null}
      {article.storyKindLabel ? <em className={classes(classNamePrefix, 'flag')}>{article.storyKindLabel}</em> : null}
      {article.coverageLabel ? <em className={classes(classNamePrefix, 'flag')}>{article.coverageLabel}</em> : null}
    </div>
  )
}

function StoryMeta({
  article,
  classNamePrefix,
  showLocation,
}: {
  readonly article: NewsPlatformArticleSummary
  readonly classNamePrefix: string
  readonly showLocation: boolean
}) {
  return (
    <div className={classes(classNamePrefix, 'story-meta')}>
      <span className={classes(classNamePrefix, 'story-author')}>{article.sourceLabel ?? article.bylineName}</span>
      {showLocation && article.locationLabel ? <span><MapPin size={11} aria-hidden="true" />{article.locationLabel}</span> : null}
      <span><Clock size={11} aria-hidden="true" />{formatNewsPlatformRelativeTime(article.publishedAt)}</span>
    </div>
  )
}

export function NewsPlatformHome({
  classNamePrefix,
  heading,
  scopeLabel,
  articles,
  hasMore,
  loadingMore,
  spotlightLabel = 'Investigations',
  preferSpotlightLead = false,
  includeLeadInSpotlights = true,
  showCategoryBadge = true,
  showLocation = true,
  onOpenArticle,
  onLoadMore,
}: {
  readonly classNamePrefix: string
  readonly heading: string
  readonly scopeLabel: string
  readonly articles: readonly NewsPlatformArticleSummary[]
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly spotlightLabel?: string
  readonly preferSpotlightLead?: boolean
  readonly includeLeadInSpotlights?: boolean
  readonly showCategoryBadge?: boolean
  readonly showLocation?: boolean
  readonly onOpenArticle: (id: string) => void
  readonly onLoadMore: () => void
}) {
  const lead = articles.find((article) => article.priority === 'breaking')
    ?? (preferSpotlightLead ? articles.find((article) => article.spotlight) : undefined)
    ?? articles[0]
  const secondary = articles.filter((article) => article.id !== lead?.id).slice(0, 4)
  const latest = articles.slice(0, 7)
  const spotlights = useMemo(
    () => articles.filter((article) => article.spotlight && (includeLeadInSpotlights || article.id !== lead?.id)).slice(0, 4),
    [articles, includeLeadInSpotlights, lead?.id],
  )

  if (!lead) return null

  return (
    <div className={classes(classNamePrefix, 'home')}>
      <header className={classes(classNamePrefix, 'home__header')}>
        <h2>{heading}</h2>
        <span className={classes(classNamePrefix, 'result-scope')}>{scopeLabel}</span>
      </header>

      <button
        type="button"
        className={classes(classNamePrefix, 'lead')}
        data-breaking={lead.priority === 'breaking' ? 'true' : 'false'}
        onClick={() => onOpenArticle(lead.id)}
      >
        <div className={classes(classNamePrefix, 'lead__body')}>
          <StoryFlags article={lead} classNamePrefix={classNamePrefix} />
          {showCategoryBadge ? <span className={classes(classNamePrefix, 'category-tag')}>{lead.categoryLabel}</span> : null}
          <h1>{lead.headline}</h1>
          {lead.summary ? <p>{lead.summary}</p> : null}
          <StoryMeta article={lead} classNamePrefix={classNamePrefix} showLocation={showLocation} />
        </div>
      </button>

      {secondary.length > 0 ? (
        <div className={classes(classNamePrefix, 'secondary-grid')}>
          {secondary.map((article) => (
            <button
              key={article.id}
              type="button"
              className={classes(classNamePrefix, 'story-card')}
              onClick={() => onOpenArticle(article.id)}
            >
              <StoryFlags article={article} classNamePrefix={classNamePrefix} />
              {showCategoryBadge ? <span className={classes(classNamePrefix, 'category-tag')}>{article.categoryLabel}</span> : null}
              <strong>{article.shortHeadline ?? article.headline}</strong>
              <StoryMeta article={article} classNamePrefix={classNamePrefix} showLocation={showLocation} />
            </button>
          ))}
        </div>
      ) : null}

      <div className={`${classes(classNamePrefix, 'home__columns')}${spotlights.length ? '' : ` ${classes(classNamePrefix, 'home__columns--single')}`}`}>
        <section className={classes(classNamePrefix, 'section')}>
          <h3>Latest</h3>
          <div className={classes(classNamePrefix, 'compact-list')}>
            {latest.map((article) => (
              <button key={article.id} type="button" onClick={() => onOpenArticle(article.id)}>
                <span>{article.shortHeadline ?? article.headline}</span>
                <time dateTime={article.publishedAt}>{formatNewsPlatformRelativeTime(article.publishedAt)}</time>
              </button>
            ))}
          </div>
        </section>

        {spotlights.length > 0 ? (
          <section className={classes(classNamePrefix, 'section')}>
            <h3>{spotlightLabel}</h3>
            <div className={classes(classNamePrefix, 'compact-list')}>
              {spotlights.map((article) => (
                <button key={article.id} type="button" onClick={() => onOpenArticle(article.id)}>
                  <span>{article.shortHeadline ?? article.headline}</span>
                  <time dateTime={article.publishedAt}>{formatNewsPlatformRelativeTime(article.publishedAt)}</time>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {hasMore ? (
        <button type="button" className={classes(classNamePrefix, 'load-more')} onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading newsroom page…' : 'Load more'}
        </button>
      ) : null}
    </div>
  )
}
