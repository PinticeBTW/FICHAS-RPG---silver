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

export function formatNewsPlatformDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'DATE UNAVAILABLE' : shortDateFormatter.format(date)
}

export function formatNewsPlatformDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'TIME UNAVAILABLE' : dateTimeFormatter.format(date)
}

export function formatNewsPlatformRelativeTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) return formatNewsPlatformDateTime(value)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'NOW'
  if (minutes < 60) return `${minutes}M AGO`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}H AGO`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}D AGO` : formatNewsPlatformDate(value).toUpperCase()
}
