// ─── Types ───────────────────────────────────────────────────────────────────

export interface RelationNpc {
  id: string
  groupId: string
  name: string
  image?: string       // base64 data URL
  idade?: string
  altura?: string
  sexo?: string
  tipoSangue?: string
  tipologia?: string
  ocupacao?: string
  relacao: number      // 0–5 (status de relações)
  acercaDe?: string
}

export interface RelationGroup {
  id: string
  name: string
}

export interface RelationsData {
  groups: RelationGroup[]
  npcs: RelationNpc[]
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_GROUPS: RelationGroup[] = [
  { id: 'noir-circuito', name: 'NOIR CIRCUITO' },
  { id: 'circuito-preto', name: 'CIRCUITO PRETO' },
  { id: 'rami', name: 'RAM' },
]

export const EMPTY_RELATIONS: RelationsData = {
  groups: DEFAULT_GROUPS,
  npcs: [],
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function parseRelationsData(raw: string | undefined): RelationsData {
  if (!raw) return EMPTY_RELATIONS
  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      'groups' in parsed &&
      'npcs' in parsed &&
      Array.isArray((parsed as RelationsData).groups) &&
      Array.isArray((parsed as RelationsData).npcs)
    ) {
      return parsed as RelationsData
    }
  } catch {
    // fall through
  }
  return EMPTY_RELATIONS
}

export function stringifyRelationsData(data: RelationsData): string {
  return JSON.stringify(data)
}

export function makeNpcId(): string {
  return `npc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function makeGroupId(): string {
  return `grp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}
