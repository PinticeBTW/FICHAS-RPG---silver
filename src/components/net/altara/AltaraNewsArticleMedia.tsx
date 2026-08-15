import type { NetAltaraNewsArticleMedia } from '../../../lib/netAltaraNewsTypes'
import {
  NewsArticleBody,
  NewsArticleHero,
  NewsArticleMediaFigure,
} from '../news/NewsArticleMedia'
import { altaraNewsMediaCopy, altaraNewsMediaTheme } from './altaraNewsMediaConfig'

export function AltaraNewsArticleMediaFigure({ media }: { readonly media: NetAltaraNewsArticleMedia }) {
  return <NewsArticleMediaFigure media={media} theme={altaraNewsMediaTheme} copy={altaraNewsMediaCopy} />
}

export function AltaraNewsArticleHero({ media }: { readonly media: readonly NetAltaraNewsArticleMedia[] }) {
  return <NewsArticleHero media={media} theme={altaraNewsMediaTheme} copy={altaraNewsMediaCopy} />
}

export function AltaraNewsArticleBody({
  body,
  media,
  emptyMessage,
}: {
  readonly body: string
  readonly media: readonly NetAltaraNewsArticleMedia[]
  readonly emptyMessage?: string
}) {
  return (
    <NewsArticleBody
      body={body}
      media={media}
      emptyMessage={emptyMessage}
      theme={altaraNewsMediaTheme}
      copy={altaraNewsMediaCopy}
    />
  )
}
