import { ImageOff, LoaderCircle, RefreshCcw } from 'lucide-react'
import { useMemo } from 'react'

import { SharedMediaImage } from '../shared/SharedMediaImage'
import type { NetNvnArticleMedia } from '../../lib/netNvnTypes'
import { splitNvnArticleParagraphs } from './nvnArticleText'

export function NvnArticleMediaFigure({ media }: { readonly media: NetNvnArticleMedia }) {
  const hero = media.placementKind === 'hero'
  return (
    <figure className="nvn-article-media" data-placement={media.placementKind}>
      <SharedMediaImage
        source={media.mediaRef}
        alt={media.altText}
        loading={hero ? 'eager' : 'lazy'}
        decoding="async"
        loadingFallback={(
          <span className="nvn-article-media__fallback" role="status">
            <LoaderCircle className="nvn-reader-feedback__spinner" size={19} aria-hidden="true" />
            <span>Resolving secure image</span>
          </span>
        )}
        errorFallback={(retry) => (
          <span className="nvn-article-media__fallback" role="alert">
            <ImageOff size={19} aria-hidden="true" />
            <span>Secure image could not be opened</span>
            <button type="button" onClick={retry}>
              <RefreshCcw size={13} aria-hidden="true" /> Retry image
            </button>
          </span>
        )}
      />
      {media.caption ? <figcaption>{media.caption}</figcaption> : null}
    </figure>
  )
}

export function NvnArticleHero({ media }: { readonly media: readonly NetNvnArticleMedia[] }) {
  const hero = media.find((item) => item.placementKind === 'hero')
  return hero ? <NvnArticleMediaFigure media={hero} /> : null
}

export function NvnArticleBody({
  body,
  media,
  emptyMessage,
}: {
  readonly body: string
  readonly media: readonly NetNvnArticleMedia[]
  readonly emptyMessage?: string
}) {
  const paragraphs = useMemo(() => splitNvnArticleParagraphs(body), [body])
  const inlineAfterParagraph = useMemo(() => {
    const grouped = new Map<number, NetNvnArticleMedia[]>()
    if (paragraphs.length === 0) return grouped
    for (const item of media) {
      if (item.placementKind !== 'inline') continue
      // paragraphIndex is zero-based. A body edit that shortens the article
      // safely moves an out-of-range placement to the final paragraph.
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
    return emptyMessage ? <div className="nvn-article__body"><p>{emptyMessage}</p></div> : null
  }

  return (
    <div className="nvn-article__body">
      {paragraphs.map((paragraph, index) => (
        <div className="nvn-article__paragraph-block" key={`${index}-${paragraph.slice(0, 32)}`}>
          <p>{paragraph}</p>
          {(inlineAfterParagraph.get(index) ?? []).map((item) => (
            <NvnArticleMediaFigure key={item.id} media={item} />
          ))}
        </div>
      ))}
    </div>
  )
}
