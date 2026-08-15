import type { NewsArticleMedia } from './newsArticleMedia'

/**
 * Product-neutral presentation contract for the shared NEWS platform.
 *
 * Adapters are responsible for translating authoritative NVN or ALTARA
 * payloads into this shape. No table name, RPC name, service scope or
 * ecosystem authority is represented here.
 */
export interface NewsPlatformArticleSummary {
  readonly id: string
  readonly slug: string
  readonly status: 'published' | 'archived'
  readonly headline: string
  readonly shortHeadline?: string
  readonly summary?: string
  readonly priority: 'standard' | 'breaking'
  readonly categoryKey: string
  readonly categoryLabel: string
  readonly storyKindLabel?: string
  readonly spotlight: boolean
  readonly bylineName: string
  readonly sourceLabel?: string
  readonly coverageLabel?: string
  readonly locationLabel?: string
  readonly publishedAt: string
  readonly updatedAt: string
  readonly archivedAt?: string
  readonly saved?: boolean
}

export interface NewsPlatformReference {
  readonly appId: string
  readonly resourceKind: string
  readonly resourceId: string
}

export interface NewsPlatformArticleDetail extends NewsPlatformArticleSummary {
  readonly body: string
  readonly bylineRole?: string
  readonly occurredAt?: string
  readonly sourceStatusLabel?: string
  readonly sourceLabels: readonly string[]
  readonly tags: readonly string[]
  readonly pullQuote?: string
  readonly pullQuoteAttribution?: string
  readonly primaryReference?: NewsPlatformReference
  readonly media: readonly NewsArticleMedia[]
}

export interface NewsPlatformIncidentUpdate {
  readonly id: string
  readonly sequence: number
  readonly kind: 'update' | 'confirmation' | 'warning' | 'correction'
  readonly kindLabel: string
  readonly body: string
  readonly publishedAt: string
  readonly verificationLabel?: string
  readonly verificationKey?: string
}

export interface NewsPlatformIncident {
  readonly id: string
  readonly headline: string
  readonly summary?: string
  readonly categoryLabel: string
  readonly coverageLabel?: string
  readonly locationLabel?: string
  readonly bylineName: string
  readonly bylineRole?: string
  readonly verificationLabel?: string
  readonly verificationKey?: string
  readonly startedAt: string
  readonly updates: readonly NewsPlatformIncidentUpdate[]
}

export interface NewsPlatformBroadcastView {
  readonly productLabel: string
  readonly programmeLabel: string
  readonly status: 'synchronizing' | 'off-air' | 'ready' | 'on-air' | 'breaking' | 'error'
  readonly currentLabel?: string
  readonly currentKindLabel?: string
  readonly transmissionLabel?: string
  readonly startedAt?: string
  readonly endsAt?: string
  readonly modeKey?: string
  readonly joining?: boolean
  readonly tunedCopy?: string
  readonly untunedCopy?: string
  readonly synchronizingCopy?: string
  readonly offAirCopy?: string
  readonly tuned: boolean
  readonly muted: boolean
  readonly volume: number
  readonly syncing: boolean
  readonly error?: string
  readonly onTuneIn: () => void
  readonly onTuneOut: () => void
  readonly onRetry: () => void
  readonly onMutedChange: (muted: boolean) => void
  readonly onVolumeChange: (volume: number) => void
}
