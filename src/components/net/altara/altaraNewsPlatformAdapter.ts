import type { NewsPlatformArticleDetail, NewsPlatformArticleSummary } from '../../../lib/newsPlatformTypes'
import type { NetAltaraNewsArticleDetail, NetAltaraNewsArticleSummary } from '../../../lib/netAltaraNewsTypes'

const sectionLabels = {
  world: 'World',
  business: 'Business',
  technology: 'Technology',
  culture: 'Culture',
} as const

export function adaptAltaraNewsSummary(article: NetAltaraNewsArticleSummary): NewsPlatformArticleSummary {
  return {
    id: article.articleId,
    slug: article.slug,
    status: article.status ?? 'published',
    headline: article.headline,
    ...(article.deck ? { summary: article.deck } : {}),
    priority: article.priority,
    categoryKey: article.section,
    categoryLabel: sectionLabels[article.section],
    spotlight: article.featured,
    bylineName: article.authorLabel,
    ...(article.sourceLabel ? { sourceLabel: article.sourceLabel } : {}),
    coverageLabel: article.coverageScope === 'local' ? 'LOCAL' : 'WORLD',
    ...(article.locationLabel ? { locationLabel: article.locationLabel } : {}),
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    ...(article.archivedAt ? { archivedAt: article.archivedAt } : {}),
    saved: article.saved,
  }
}

export function adaptAltaraNewsDetail(detail: NetAltaraNewsArticleDetail): NewsPlatformArticleDetail {
  return {
    ...adaptAltaraNewsSummary(detail.article),
    body: detail.article.body,
    bylineRole: detail.article.sourceLabel ?? 'ALTARA newsroom',
    sourceLabels: detail.article.sourceLabel ? [detail.article.sourceLabel] : [],
    tags: [],
    primaryReference: {
      appId: 'altara-news',
      resourceKind: 'article',
      resourceId: detail.article.articleId,
    },
    media: detail.media,
  }
}
