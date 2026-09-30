export function metricPercentage(current: string, maximum: string): number | null {
  const parse = (value: string) => {
    const normalized = value.trim().replace(',', '.')
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null
    const number = Number(normalized)
    return Number.isFinite(number) ? number : null
  }
  const value = parse(current)
  const total = parse(maximum)
  if (value === null || total === null || total <= 0) return null
  return Math.min(100, Math.max(0, value / total * 100))
}

// A delayed initial read or event must not roll back a more recent sheet.
export function newerSnapshot<T extends { updatedAt: string }>(current: T | null | undefined, incoming: T | null): T | null {
  if (!current) return incoming
  if (!incoming) return current
  return incoming.updatedAt >= current.updatedAt ? incoming : current
}
