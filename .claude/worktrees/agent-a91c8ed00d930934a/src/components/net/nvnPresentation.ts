import type {
  NetNvnBylineKind,
  NetNvnCategory,
  NetNvnSourceStatus,
  NetNvnStoryKind,
} from '../../lib/netNvnTypes'

export const NVN_CATEGORY_LABELS: Record<NetNvnCategory, string> = {
  'new-vega': 'New Vega',
  world: 'World',
  business: 'Business',
  technology: 'Technology',
  culture: 'Culture',
  opinion: 'Opinion',
}

export const NVN_STORY_KIND_LABELS: Record<NetNvnStoryKind, string> = {
  report: 'Report',
  investigation: 'Investigation',
  opinion: 'Opinion',
}

export const NVN_BYLINE_KIND_LABELS: Record<NetNvnBylineKind, string> = {
  reporter: 'Reporter',
  desk: 'Newsroom desk',
  editorial: 'Editorial',
  protected: 'Protected identity',
}

export const NVN_SOURCE_STATUS_LABELS: Record<NetNvnSourceStatus, string> = {
  verified: 'Verified',
  'multiple-sources': 'Multiple independent sources',
  'official-statement': 'Official statement only',
  developing: 'Developing',
  'protected-source': 'Protected source',
  unconfirmed: 'Unconfirmed',
}

const shortDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatNvnDate(value: string): string {
  return shortDateFormatter.format(new Date(value))
}

export function formatNvnDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value))
}

export function formatNvnRelativeTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) return formatNvnDateTime(value)

  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return 'NOW'
  if (minutes < 60) return `${minutes}M AGO`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}H AGO`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}D AGO` : formatNvnDate(value).toUpperCase()
}

export function netNvnArticleReference(slug: string): string {
  return `NVN://story/${slug}`
}
