import { ArrowLeft, Clock, Copy, MapPin, Quote as QuoteIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { NetNvnArticleDetail } from '../../lib/netNvnTypes'
import {
  NVN_BYLINE_KIND_LABELS,
  NVN_CATEGORY_LABELS,
  NVN_SOURCE_STATUS_LABELS,
  NVN_STORY_KIND_LABELS,
  formatNvnDateTime,
  netNvnArticleReference,
} from './nvnPresentation'
import { NvnArticleBody, NvnArticleHero } from './NvnArticleMedia'

interface NvnArticleViewProps {
  article: NetNvnArticleDetail
  onBack: () => void
  onNotice: (message: string) => void
}

export function NvnArticleView({ article, onBack, onNotice }: NvnArticleViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    element.scrollTop = 0

    const handleScroll = () => {
      const maximum = element.scrollHeight - element.clientHeight
      setProgress(
        maximum > 0
          ? Math.min(100, Math.max(0, (element.scrollTop / maximum) * 100))
          : 0,
      )
    }

    handleScroll()
    element.addEventListener('scroll', handleScroll, { passive: true })
    return () => element.removeEventListener('scroll', handleScroll)
  }, [article.id])

  const handleCopyReference = async () => {
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
    <div className="nvn-article-shell">
      <div className="nvn-progress" aria-hidden="true">
        <i style={{ width: `${progress}%` }} />
      </div>

      <article className="nvn-article" ref={containerRef}>
        <button type="button" className="nvn-back" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" />
          Back
        </button>

        <div className="nvn-article__eyebrow">
          <span className="nvn-category-tag">{NVN_CATEGORY_LABELS[article.category]}</span>
          {article.priority === 'breaking' ? (
            <em className="nvn-flag nvn-flag--breaking">Breaking</em>
          ) : null}
          {article.storyKind !== 'report' ? (
            <em className="nvn-flag">{NVN_STORY_KIND_LABELS[article.storyKind]}</em>
          ) : null}
          {article.status === 'archived' ? <em className="nvn-flag">Archived</em> : null}
        </div>

        <h1>{article.headline}</h1>
        {article.summary ? <p className="nvn-article__deck">{article.summary}</p> : null}

        <div className="nvn-article__byline">
          <div className="nvn-article__byline-identity">
            <span className="nvn-avatar-initial" aria-hidden="true">
              {article.bylineName.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{article.bylineName}</strong>
              <small>
                {article.bylineRole ?? NVN_BYLINE_KIND_LABELS[article.bylineKind]}
              </small>
            </span>
          </div>

          <span className="nvn-article__meta">
            <Clock size={12} aria-hidden="true" />
            Published {formatNvnDateTime(article.publishedAt)}
            {article.updatedAt !== article.publishedAt
              ? ` · Updated ${formatNvnDateTime(article.updatedAt)}`
              : ''}
          </span>

          {article.districtLabel || article.locationLabel ? (
            <span className="nvn-district-chip">
              <MapPin size={11} aria-hidden="true" />
              {[article.districtLabel, article.locationLabel].filter(Boolean).join(' · ')}
            </span>
          ) : null}
        </div>

        {article.occurredAt ? (
          <p className="nvn-article__occurred">
            Event timestamp: {formatNvnDateTime(article.occurredAt)}
          </p>
        ) : null}

        <NvnArticleHero media={article.media} />
        <NvnArticleBody body={article.body} media={article.media} />

        {article.pullQuote && article.pullQuoteAttribution ? (
          <blockquote className="nvn-pullquote">
            <QuoteIcon size={16} aria-hidden="true" />
            <p>{article.pullQuote}</p>
            <cite>{article.pullQuoteAttribution}</cite>
          </blockquote>
        ) : null}

        {article.tags.length > 0 ? (
          <div className="nvn-article__tags" aria-label="Article tags">
            {article.tags.map((tag) => <span key={tag}>#{tag}</span>)}
          </div>
        ) : null}

        <div className="nvn-source-block">
          <span>
            Source status: <strong>{NVN_SOURCE_STATUS_LABELS[article.sourceStatus]}</strong>
          </span>
          {article.sourceLabels.length > 0 ? (
            <ul>
              {article.sourceLabels.map((source) => <li key={source}>{source}</li>)}
            </ul>
          ) : null}
        </div>

        {article.primaryReference ? (
          <div className="nvn-reference-block">
            <span>Linked public-grid reference</span>
            <code>
              {article.primaryReference.appId}/{article.primaryReference.resourceKind}/
              {article.primaryReference.resourceId}
            </code>
          </div>
        ) : null}

        <div className="nvn-article__actions">
          <button type="button" onClick={handleCopyReference}>
            <Copy size={14} aria-hidden="true" />
            Copy reference
          </button>
        </div>
      </article>
    </div>
  )
}
