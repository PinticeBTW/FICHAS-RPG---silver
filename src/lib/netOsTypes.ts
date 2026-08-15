export const netOsIds = ['veil', 'altara'] as const

export type NetOsId = (typeof netOsIds)[number]
export type NetAppScope = 'veil-only' | 'altara-only' | 'global'

export interface NetOsOption {
  readonly id: NetOsId
  readonly label: string
}

export const netOsOptions: readonly NetOsOption[] = [
  { id: 'veil', label: 'VEIL OS' },
  { id: 'altara', label: 'ALTARA OS' },
]

export function isNetOsId(value: unknown): value is NetOsId {
  return typeof value === 'string' && netOsIds.some((id) => id === value)
}

export function getNetOsLabel(id: NetOsId): string {
  return netOsOptions.find((option) => option.id === id)?.label ?? id.toUpperCase()
}

export function netAppScopeAllows(scope: NetAppScope, osId: NetOsId): boolean {
  return scope === 'global'
    || (scope === 'veil-only' && osId === 'veil')
    || (scope === 'altara-only' && osId === 'altara')
}

/** Descriptive GM assistance only. The returned value never grants authority. */
export function suggestNetOsForCity(city?: string): NetOsId | undefined {
  const normalized = city
    ?.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase()
  if (!normalized) return undefined

  return /(^|\s)(new|n3w)\s*v(?:e|3)ga($|\s)/.test(normalized)
    ? 'veil'
    : 'altara'
}
