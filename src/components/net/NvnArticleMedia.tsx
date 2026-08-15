import {
  NewsArticleBody,
  NewsArticleHero,
  NewsArticleMediaFigure,
} from './news/NewsArticleMedia'
import type { NetNvnArticleMedia } from '../../lib/netNvnTypes'

const theme = {
  figure: 'nvn-article-media',
  fallback: 'nvn-article-media__fallback',
  spinner: 'nvn-reader-feedback__spinner',
  body: 'nvn-article__body',
  paragraphBlock: 'nvn-article__paragraph-block',
} as const

const copy = {
  resolving: 'Resolving secure image',
  unavailable: 'Secure image could not be opened',
  retry: 'Retry image',
} as const

export function NvnArticleMediaFigure({ media }: { readonly media: NetNvnArticleMedia }) {
  return <NewsArticleMediaFigure media={media} theme={theme} copy={copy} />
}

export function NvnArticleHero({ media }: { readonly media: readonly NetNvnArticleMedia[] }) {
  return <NewsArticleHero media={media} theme={theme} copy={copy} />
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
  return <NewsArticleBody body={body} media={media} emptyMessage={emptyMessage} theme={theme} copy={copy} />
}
