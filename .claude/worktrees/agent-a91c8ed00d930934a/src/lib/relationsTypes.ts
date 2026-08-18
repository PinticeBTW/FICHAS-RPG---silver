export interface RelationNpc {
  id: string
  groupId: string
  name: string
  image?: string
  idade?: string
  altura?: string
  sexo?: string
  tipoSangue?: string
  tipologia?: string
  ocupacao?: string
  karma?: string
  relacao: number
  acercaDe?: string
  sharedFromProfileId?: string
  sharedFromRelationId?: string
  sharedByProfileId?: string
  sharedAt?: string
}

export interface RelationGroup {
  id: string
  name: string
}

export interface RelationsData {
  groups: RelationGroup[]
  npcs: RelationNpc[]
}

export const DEFAULT_GROUPS: RelationGroup[] = [
  { id: 'noir-circuito', name: 'NOIR CIRCUITO' },
  { id: 'circuito-preto', name: 'CIRCUITO PRETO' },
  { id: 'rami', name: 'RAM' },
]

export const EMPTY_RELATIONS: RelationsData = {
  groups: DEFAULT_GROUPS,
  npcs: [],
}

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
    return EMPTY_RELATIONS
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

function normalizeGroupName(name: string) {
  return name.trim().toLocaleLowerCase()
}

function makeSharedRelationKey(profileId: string | undefined, relationId: string | undefined) {
  return profileId && relationId ? `${profileId}:${relationId}` : ''
}

function ensureUniqueRelationId(candidateId: string, npcs: RelationNpc[]) {
  if (!npcs.some((npc) => npc.id === candidateId)) {
    return candidateId
  }

  return makeNpcId()
}

export function mergeSharedRelationsData(
  target: RelationsData,
  incoming: RelationsData,
  options: {
    sourceProfileId: string
    sharedByProfileId: string
    sharedAt?: string
  },
): RelationsData {
  const sharedAt = options.sharedAt ?? new Date().toISOString()
  const groups = target.groups.length ? [...target.groups] : [...DEFAULT_GROUPS]
  const npcs = [...target.npcs]
  const groupIdByIncomingId = new Map<string, string>()
  const groupIdByName = new Map(
    groups.map((group) => [normalizeGroupName(group.name), group.id] as const),
  )

  for (const group of incoming.groups) {
    const normalizedName = normalizeGroupName(group.name)
    const existingGroupId = groupIdByName.get(normalizedName)

    if (existingGroupId) {
      groupIdByIncomingId.set(group.id, existingGroupId)
      continue
    }

    const nextGroup = {
      ...group,
      id: groups.some((existing) => existing.id === group.id) ? makeGroupId() : group.id,
    }

    groups.push(nextGroup)
    groupIdByName.set(normalizedName, nextGroup.id)
    groupIdByIncomingId.set(group.id, nextGroup.id)
  }

  for (const relation of incoming.npcs) {
    const sharedFromProfileId = relation.sharedFromProfileId ?? options.sourceProfileId
    const sharedFromRelationId = relation.sharedFromRelationId ?? relation.id
    const sharedKey = makeSharedRelationKey(sharedFromProfileId, sharedFromRelationId)
    const targetGroupId = groupIdByIncomingId.get(relation.groupId) ?? groups[0]?.id ?? ''
    const existingIndex = npcs.findIndex((candidate) => {
      const candidateKey = makeSharedRelationKey(
        candidate.sharedFromProfileId,
        candidate.sharedFromRelationId,
      )

      return (
        (candidateKey && candidateKey === sharedKey) ||
        candidate.id === relation.id
      )
    })
    const existingRelation = existingIndex >= 0 ? npcs[existingIndex] : null
    const nextRelation: RelationNpc = {
      ...relation,
      id: existingRelation
        ? existingRelation.id
        : ensureUniqueRelationId(relation.id, npcs),
      groupId: targetGroupId,
      sharedFromProfileId,
      sharedFromRelationId,
      sharedByProfileId: options.sharedByProfileId,
      sharedAt,
    }

    if (existingIndex >= 0) {
      npcs[existingIndex] = nextRelation
    } else {
      npcs.push(nextRelation)
    }
  }

  return {
    groups,
    npcs,
  }
}
