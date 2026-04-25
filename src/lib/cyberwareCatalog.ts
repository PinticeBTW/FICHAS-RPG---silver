import type { Cyberware, CyberwareGroupId } from '../types/cyberware'
import { cyberwareSheetZones } from './cyberwareSheetLayout'

const cyberwareGroupIds = cyberwareSheetZones.map((zone) => zone.id)
const cyberwareGroupIdSet = new Set<CyberwareGroupId>(cyberwareGroupIds)

function isCyberwareGroupId(value: string): value is CyberwareGroupId {
  return cyberwareGroupIdSet.has(value as CyberwareGroupId)
}

function coerceCyberwareNumber(value: unknown) {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/[^\d.-]/g, '').trim())
        : NaN

  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0
}

function coerceCyberwareText(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function normalizeProfileIds(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const ids = [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => entry.trim()),
    ),
  ]
  return ids.length ? ids : []
}

function normalizeCyberwareAccess(entry: Cyberware): Cyberware {
  return {
    ...entry,
    icon: typeof entry.icon === 'string' ? entry.icon : undefined,
    playerCanView: entry.playerCanView !== false,
    playerCanEquip: entry.playerCanEquip !== false,
    allowedViewerProfileIds: normalizeProfileIds(entry.allowedViewerProfileIds),
    allowedEquipperProfileIds: normalizeProfileIds(entry.allowedEquipperProfileIds),
  }
}

export function getCyberwareDisplayName(entry: Pick<Cyberware, 'name'> | null | undefined) {
  const trimmedName = entry?.name?.trim() ?? ''
  return trimmedName || 'Cyberware sem nome'
}

export function getCyberwareDisplayDescription(entry: Pick<Cyberware, 'description'> | null | undefined) {
  const trimmedDescription = entry?.description?.trim() ?? ''
  return trimmedDescription || 'Sem descricao.'
}

export function createEmptySheetCyberware(slotType: CyberwareGroupId = 'cortex'): Cyberware {
  return {
    id: crypto.randomUUID(),
    name: 'Nova cyberware',
    slotType,
    description: 'Descreve o efeito e o contexto desta cyberware.',
    cyberCost: 0,
    shieldValue: 0,
    icon: '',
    playerCanView: true,
    playerCanEquip: true,
  }
}

export function parseSheetCyberwareCatalog(value: string | undefined): Cyberware[] {
  if (!value?.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    const normalizedEntries = parsed.flatMap((rawEntry, index) => {
      if (!rawEntry || typeof rawEntry !== 'object') {
        return []
      }

      const entry = rawEntry as Record<string, unknown>
      const rawSlotType = typeof entry.slotType === 'string' ? entry.slotType : ''
      const slotType = isCyberwareGroupId(rawSlotType) ? rawSlotType : 'cortex'

      return [
        normalizeCyberwareAccess({
          id:
            typeof entry.id === 'string' && entry.id.trim()
              ? entry.id.trim()
              : `sheet-cyberware-${index + 1}`,
          name: coerceCyberwareText(entry.name, ''),
          slotType,
          description: coerceCyberwareText(entry.description, ''),
          cyberCost: coerceCyberwareNumber(entry.cyberCost),
          shieldValue: coerceCyberwareNumber(entry.shieldValue),
          icon: typeof entry.icon === 'string' ? entry.icon : '',
          playerCanView: entry.playerCanView !== false,
          playerCanEquip: entry.playerCanEquip !== false,
          allowedViewerProfileIds: normalizeProfileIds(entry.allowedViewerProfileIds),
          allowedEquipperProfileIds: normalizeProfileIds(entry.allowedEquipperProfileIds),
        }),
      ]
    })

    return normalizedEntries
  } catch {
    return []
  }
}

export function stringifySheetCyberwareCatalog(entries: Cyberware[]) {
  return JSON.stringify(
    entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      slotType: entry.slotType,
      description: entry.description,
      cyberCost: coerceCyberwareNumber(entry.cyberCost),
      shieldValue: coerceCyberwareNumber(entry.shieldValue),
      icon: typeof entry.icon === 'string' ? entry.icon : '',
      playerCanView: entry.playerCanView !== false,
      playerCanEquip: entry.playerCanEquip !== false,
      allowedViewerProfileIds: normalizeProfileIds(entry.allowedViewerProfileIds),
      allowedEquipperProfileIds: normalizeProfileIds(entry.allowedEquipperProfileIds),
    })),
  )
}

export function buildSheetCyberwareCatalogById(entries: Cyberware[]) {
  return Object.fromEntries(entries.map((entry) => [entry.id, normalizeCyberwareAccess(entry)])) as Record<
    string,
    Cyberware
  >
}

export function buildSheetCyberwaresByGroup(entries: Cyberware[]) {
  return Object.fromEntries(
    cyberwareGroupIds.map((groupId) => [
      groupId,
      entries.filter((entry) => entry.slotType === groupId),
    ]),
  ) as Record<CyberwareGroupId, Cyberware[]>
}

export function canPlayerViewCyberware(entry: Cyberware | null | undefined) {
  return entry?.playerCanView !== false
}

export function canPlayerEquipCyberware(entry: Cyberware | null | undefined) {
  return entry?.playerCanEquip !== false
}

function hasExplicitViewerList(entry: Cyberware | null | undefined) {
  return Array.isArray(entry?.allowedViewerProfileIds)
}

function hasExplicitEquipperList(entry: Cyberware | null | undefined) {
  return Array.isArray(entry?.allowedEquipperProfileIds)
}

export function resolveCyberwareViewerProfileIds(entry: Cyberware | null | undefined) {
  if (!entry) {
    return []
  }

  if (hasExplicitViewerList(entry)) {
    return entry.allowedViewerProfileIds ?? []
  }

  return canPlayerViewCyberware(entry) ? null : []
}

export function resolveCyberwareEquipperProfileIds(entry: Cyberware | null | undefined) {
  if (!entry) {
    return []
  }

  if (hasExplicitEquipperList(entry)) {
    return entry.allowedEquipperProfileIds ?? []
  }

  return canPlayerEquipCyberware(entry) ? null : []
}

export function canProfileViewCyberware(
  entry: Cyberware | null | undefined,
  profileId: string | null | undefined,
) {
  if (!entry || !profileId) {
    return false
  }

  const allowedViewerIds = resolveCyberwareViewerProfileIds(entry)
  return allowedViewerIds === null ? true : allowedViewerIds.includes(profileId)
}

export function canProfileEquipCyberware(
  entry: Cyberware | null | undefined,
  profileId: string | null | undefined,
) {
  if (!entry || !profileId) {
    return false
  }

  if (!canProfileViewCyberware(entry, profileId)) {
    return false
  }

  const allowedEquipperIds = resolveCyberwareEquipperProfileIds(entry)
  return allowedEquipperIds === null ? true : allowedEquipperIds.includes(profileId)
}

export function createHiddenCyberwarePlaceholder(slotType: CyberwareGroupId): Cyberware {
  return {
    id: `hidden-${slotType}`,
    name: '??',
    slotType,
    description: 'O Silver ainda nao revelou esta cyberware.',
    cyberCost: 0,
    shieldValue: 0,
    playerCanView: false,
    playerCanEquip: false,
  }
}
