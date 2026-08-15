import { ArrowLeft, Bookmark, BookmarkCheck, Clock, Copy, MapPin, Quote as QuoteIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { NewsPlatformArticleDetail, NewsPlatformArticleSummary } from '../../../lib/newsPlatformTypes'
import { formatNewsPlatformDateTime } from './newsPlatformPresentation'

function classes(prefix: string, token: string) {
  return `${prefix}-${token}`
}

export function NewsPlatformArticleReader({
  classNamePrefix,
  article,
  backLabel = 'Back',
  copyLabel = 'Copy reference',
  referenceLabel = 'Linked network reference',
  related = [],
  relatedLabel = 'Related coverage',
  hero,
  body,
  onBack,
  onCopyReference,
  onSavedChange,
  onOpenRelated,
}: {
  readonly classNamePrefix: string
  readonly article: NewsPlatformArticleDetail
  readonly backLabel?: string
  readonly copyLabel?: string
  readonly referenceLabel?: string
  readonly related?: readonly NewsPlatformArticleSummary[]
  readonly relatedLabel?: string
  readonly hero: ReactNode
  readonly body: ReactNode
  readonly onBack: () => void
  readonly onCopyReference: () => void
  readonly onSavedChange?: (saved: boolean) => void
  readonly onOpenRelated?: (articleId: string) => void
}) {
  const containerRef = useRef<HTMLElement | null>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    element.scrollTop = 0
    const handleScroll = () => {
      const maximum = element.scrollHeight - element.clientHeight
      setProgress(maximum > 0 ? Math.min(100, Math.max(0, (element.scrollTop / maximum) * 100)) : 0)
    }
    handleScroll()
    element.addEventListener('scroll', handleScroll, { passive: true })
    return () => element.removeEventListener('scroll', handleScroll)
  }, [article.id])

  return (
    <div className={classes(classNamePrefix, 'article-shell')} data-has-rail={related.length > 0 ? 'true' : undefined}>
      <div className={classes(classNamePrefix, 'progress')} aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
      <article className={classes(classNamePrefix, 'article')} ref={containerRef}>
        <button type="button" className={classes(classNamePrefix, 'back')} onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" />{backLabel}
        </button>

        <div className={classes(classNamePrefix, 'article__eyebrow')}>
          <span className={classes(classNamePrefix, 'category-tag')}>{article.categoryLabel}</span>
          {article.coverageLabel ? <em className={classes(classNamePrefix, 'flag')}>{article.coverageLabel}</em> : null}
          {article.priority === 'breaking' ? <em className={`${classes(classNamePrefix, 'flag')} ${classes(classNamePrefix, 'flag--breaking')}`}>Breaking</em> : null}
          {article.storyKindLabel ? <em className={classes(classNamePrefix, 'flag')}>{article.storyKindLabel}</em> : null}
          {article.status === 'archived' ? <em className={classes(classNamePrefix, 'flag')}>Archived</em> : null}
        </div>

        <h1>{article.headline}</h1>
        {article.summary ? <p className={classes(classNamePrefix, 'article__deck')}>{article.summary}</p> : null}

        <div className={classes(classNamePrefix, 'article__byline')}>
          <div className={classes(classNamePrefix, 'article__byline-identity')}>
            <span className={classes(classNamePrefix, 'avatar-initial')} aria-hidden="true">
              {article.bylineName.slice(0, 1).toUpperCase()}
            </span>
            <span><strong>{article.bylineName}</strong><small>{article.bylineRole ?? article.sourceLabel ?? 'Newsroom desk'}</small></span>
          </div>
          <span className={classes(classNamePrefix, 'article__meta')}>
            <Clock size={12} aria-hidden="true" />Published {formatNewsPlatformDateTime(article.publishedAt)}
            {article.updatedAt !== article.publishedAt ? ` · Updated ${formatNewsPlatformDateTime(article.updatedAt)}` : ''}
          </span>
          {article.locationLabel ? <span className={classes(classNamePrefix, 'district-chip')}><MapPin size={11} aria-hidden="true" />{article.locationLabel}</span> : null}
        </div>

        {article.occurredAt ? <p className={classes(classNamePrefix, 'article__occurred')}>Event timestamp: {formatNewsPlatformDateTime(article.occurredAt)}</p> : null}
        {hero}
        {body}

        {article.pullQuote ? (
          <blockquote className={classes(classNamePrefix, 'pullquote')}>
            <QuoteIcon size={16} aria-hidden="true" /><p>{article.pullQuote}</p>
            {article.pullQuoteAttribution ? <cite>{article.pullQuoteAttribution}</cite> : null}
          </blockquote>
        ) : null}

        {article.tags.length > 0 ? <div className={classes(classNamePrefix, 'article__tags')} aria-label="Article tags">{article.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div> : null}
        {article.sourceStatusLabel || article.sourceLabels.length > 0 ? (
          <div className={classes(classNamePrefix, 'source-block')}>
            {article.sourceStatusLabel ? <span>Source status: <strong>{article.sourceStatusLabel}</strong></span> : null}
            {article.sourceLabels.length ? <ul>{article.sourceLabels.map((source) => <li key={source}>{source}</li>)}</ul> : null}
          </div>
        ) : null}
        {article.primaryReference ? (
          <div className={classes(classNamePrefix, 'reference-block')}>
            <span>{referenceLabel}</span>
            <code>{article.primaryReference.appId}/{article.primaryReference.resourceKind}/{article.primaryReference.resourceId}</code>
          </div>
        ) : null}

        <div className={classes(classNamePrefix, 'article__actions')}>
          {onSavedChange && typeof article.saved === 'boolean' ? (
            <button type="button" onClick={() => onSavedChange(!article.saved)}>
              {article.saved ? <BookmarkCheck size={14} aria-hidden="true" /> : <Bookmark size={14} aria-hidden="true" />}
              {article.saved ? 'Saved' : 'Save'}
            </button>
          ) : null}
          <button type="button" onClick={onCopyReference}><Copy size={14} aria-hidden="true" />{copyLabel}</button>
        </div>
      </article>
      {related.length > 0 && onOpenRelated ? (
        <aside className={classes(classNamePrefix, 'article-rail')}>
          <header><small>NETWORK EDITION</small><h3>{relatedLabel}</h3></header>
          <div className={classes(classNamePrefix, 'article-rail__stories')}>
            {related.map((item) => (
              <button key={item.id} type="button" onClick={() => onOpenRelated(item.id)}>
                <span>{item.coverageLabel ?? item.categoryLabel}</span>
                <strong>{item.shortHeadline ?? item.headline}</strong>
                <small>{formatNewsPlatformDateTime(item.publishedAt)}</small>
              </button>
            ))}
          </div>
        </aside>
      ) : null}
    </div>
  )
}
