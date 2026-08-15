import { ImageOff, LoaderCircle, RefreshCcw } from 'lucide-react'
import { useMemo } from 'react'

import type { NewsArticleMedia } from '../../../lib/newsArticleMedia'
import { splitNewsArticleParagraphs } from '../../../lib/newsArticleMedia'
import { SharedMediaImage } from '../../shared/SharedMediaImage'

export interface NewsArticleMediaTheme {
  readonly figure: string
  readonly fallback: string
  readonly spinner: string
  readonly body: string
  readonly paragraphBlock: string
}

export interface NewsArticleMediaCopy {
  readonly resolving: string
  readonly unavailable: string
  readonly retry: string
}

export function NewsArticleMediaFigure({
  media,
  theme,
  copy,
}: {
  readonly media: NewsArticleMedia
  readonly theme: NewsArticleMediaTheme
  readonly copy: NewsArticleMediaCopy
}) {
  const hero = media.placementKind === 'hero'
  return (
    <figure className={theme.figure} data-placement={media.placementKind}>
      <SharedMediaImage
        source={media.mediaRef}
        alt={media.altText}
        loading={hero ? 'eager' : 'lazy'}
        decoding="async"
        loadingFallback={(
          <span className={theme.fallback} role="status">
            <LoaderCircle className={theme.spinner} size={19} aria-hidden="true" />
            <span>{copy.resolving}</span>
          </span>
        )}
        errorFallback={(retry) => (
          <span className={theme.fallback} role="alert">
            <ImageOff size={19} aria-hidden="true" />
            <span>{copy.unavailable}</span>
            <button type="button" onClick={retry}>
              <RefreshCcw size={13} aria-hidden="true" /> {copy.retry}
            </button>
          </span>
        )}
      />
      {media.caption ? <figcaption>{media.caption}</figcaption> : null}
    </figure>
  )
}

export function NewsArticleHero({
  media,
  theme,
  copy,
}: {
  readonly media: readonly NewsArticleMedia[]
  readonly theme: NewsArticleMediaTheme
  readonly copy: NewsArticleMediaCopy
}) {
  const hero = media.find((item) => item.placementKind === 'hero')
  return hero ? <NewsArticleMediaFigure media={hero} theme={theme} copy={copy} /> : null
}

export function NewsArticleBody({
  body,
  media,
  emptyMessage,
  theme,
  copy,
}: {
  readonly body: string
  readonly media: readonly NewsArticleMedia[]
  readonly emptyMessage?: string
  readonly theme: NewsArticleMediaTheme
  readonly copy: NewsArticleMediaCopy
}) {
  const paragraphs = useMemo(() => splitNewsArticleParagraphs(body), [body])
  const inlineAfterParagraph = useMemo(() => {
    const grouped = new Map<number, NewsArticleMedia[]>()
    if (paragraphs.length === 0) return grouped
    for (const item of media) {
      if (item.placementKind !== 'inline') continue
      const boundary = Math.min(item.paragraphIndex ?? 0, paragraphs.length - 1)
      const group = grouped.get(boundary) ?? []
      group.push(item)
      grouped.set(boundary, group)
    }
    for (const group of grouped.values()) {
      group.sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    }
    return grouped
  }, [media, paragraphs.length])

  if (paragraphs.length === 0) {
    return emptyMessage ? <div className={theme.body}><p>{emptyMessage}</p></div> : null
  }

  return (
    <div className={theme.body}>
      {paragraphs.map((paragraph, index) => (
        <div className={theme.paragraphBlock} key={`${index}-${paragraph.slice(0, 32)}`}>
          <p>{paragraph}</p>
          {(inlineAfterParagraph.get(index) ?? []).map((item) => (
            <NewsArticleMediaFigure key={item.id} media={item} theme={theme} copy={copy} />
          ))}
        </div>
      ))}
    </div>
  )
}
