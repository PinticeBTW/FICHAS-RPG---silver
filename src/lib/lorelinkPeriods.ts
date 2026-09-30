import type { LoreEntity } from './lorelinkTypes'

export type LorePeriod = 'past' | 'campaign' | 'unassigned'
export const lorePeriods: Record<LorePeriod, { label: string; description: string }> = {
  past: { label: 'Passado', description: 'Origens, memórias e tudo o que aconteceu antes da campanha.' },
  campaign: { label: 'Durante a campanha', description: 'Sessões, descobertas e acontecimentos que estão a mudar a história.' },
  unassigned: { label: 'Por organizar', description: 'Os teus registos anteriores estão aqui. Escolhe um período quando quiseres.' },
}

// Versioned tags use the existing entity save, revision and export contracts.
// Only these exact markers are reserved; legacy records are never reclassified.
const markers = { past: 'lorelink:period:v1:past', campaign: 'lorelink:period:v1:campaign' } as const
export const loreUserTags = (tags: string[]) => tags.filter(tag => tag !== markers.past && tag !== markers.campaign)
export function lorePeriod(entity: Pick<LoreEntity, 'tags'>): LorePeriod {
  if (entity.tags.includes(markers.past)) return 'past'
  if (entity.tags.includes(markers.campaign)) return 'campaign'
  return 'unassigned'
}
export function withLorePeriod(tags: string[], period: LorePeriod): string[] {
  const userTags = loreUserTags(tags)
  if (period === 'unassigned') return userTags
  if (userTags.length >= 30) throw new Error('Retira uma etiqueta antes de escolher o período. As tuas etiquetas foram preservadas.')
  return [...userTags, markers[period]]
}
