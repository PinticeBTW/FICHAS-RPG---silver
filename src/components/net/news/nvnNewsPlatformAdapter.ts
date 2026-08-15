import type { NewsPlatformArticleDetail, NewsPlatformArticleSummary, NewsPlatformIncident } from '../../../lib/newsPlatformTypes'
import type { NetNvnArticleDetail, NetNvnArticlePublicMetadata, NetNvnArticleSummary } from '../../../lib/netNvnTypes'
import type { NetNvnLiveDesk } from '../../../lib/netNvnLiveTypes'
import { NVN_BYLINE_KIND_LABELS, NVN_CATEGORY_LABELS, NVN_SOURCE_STATUS_LABELS, NVN_STORY_KIND_LABELS } from '../nvnPresentation'

const incidentVerificationLabels = {
  developing: 'Developing',
  verified: 'Verified',
  'multiple-sources': 'Multiple sources',
  'official-statement': 'Official statement',
  unconfirmed: 'Unconfirmed',
} as const

const updateKindLabels = {
  update: 'Update',
  confirmation: 'Confirmation',
  warning: 'Warning',
  correction: 'Correction',
} as const

const updateVerificationLabels = {
  confirmed: 'Confirmed',
  developing: 'Developing',
  unconfirmed: 'Unconfirmed',
} as const

export function adaptNvnArticleSummary(article: NetNvnArticleSummary | NetNvnArticlePublicMetadata): NewsPlatformArticleSummary {
  return {
    id: article.id,
    slug: article.slug,
    status: article.status,
    headline: article.headline,
    ...(article.shortHeadline ? { shortHeadline: article.shortHeadline } : {}),
    ...(article.summary ? { summary: article.summary } : {}),
    priority: article.priority,
    categoryKey: article.category,
    categoryLabel: NVN_CATEGORY_LABELS[article.category],
    ...(article.storyKind !== 'report' ? { storyKindLabel: NVN_STORY_KIND_LABELS[article.storyKind] } : {}),
    spotlight: article.storyKind === 'investigation',
    bylineName: article.bylineName,
    ...(article.districtLabel || article.locationLabel ? { locationLabel: [article.districtLabel, article.locationLabel].filter(Boolean).join(' · ') } : {}),
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    ...(article.archivedAt ? { archivedAt: article.archivedAt } : {}),
  }
}

export function adaptNvnArticleDetail(article: NetNvnArticleDetail): NewsPlatformArticleDetail {
  return {
    ...adaptNvnArticleSummary(article),
    body: article.body,
    bylineRole: article.bylineRole ?? NVN_BYLINE_KIND_LABELS[article.bylineKind],
    ...(article.occurredAt ? { occurredAt: article.occurredAt } : {}),
    sourceStatusLabel: NVN_SOURCE_STATUS_LABELS[article.sourceStatus],
    sourceLabels: article.sourceLabels,
    tags: article.tags,
    ...(article.pullQuote ? { pullQuote: article.pullQuote } : {}),
    ...(article.pullQuoteAttribution ? { pullQuoteAttribution: article.pullQuoteAttribution } : {}),
    ...(article.primaryReference ? { primaryReference: article.primaryReference } : {}),
    media: article.media,
  }
}

export function adaptNvnIncident(desk: NetNvnLiveDesk): NewsPlatformIncident | undefined {
  if (!desk.incident) return undefined
  const incident = desk.incident
  return {
    id: incident.id,
    headline: incident.headline,
    ...(incident.summary ? { summary: incident.summary } : {}),
    categoryLabel: NVN_CATEGORY_LABELS[incident.category],
    ...(incident.locationLabel || incident.districtLabel ? { locationLabel: [incident.locationLabel, incident.districtLabel].filter(Boolean).join(' · ') } : {}),
    bylineName: incident.bylineName,
    ...(incident.bylineRole ? { bylineRole: incident.bylineRole } : {}),
    verificationLabel: incidentVerificationLabels[incident.verificationStatus],
    verificationKey: incident.verificationStatus,
    startedAt: incident.startedAt,
    updates: desk.updates.map((update) => ({
      id: update.id,
      sequence: update.sequence,
      kind: update.updateKind,
      kindLabel: updateKindLabels[update.updateKind],
      body: update.body,
      publishedAt: update.publishedAt,
      verificationLabel: updateVerificationLabels[update.verificationStatus],
      verificationKey: update.verificationStatus,
    })),
  }
}
