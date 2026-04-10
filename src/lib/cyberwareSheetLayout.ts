export type CyberwareSheetZoneId =
  | 'frontalCortex'
  | 'eyes'
  | 'arms'
  | 'hands'
  | 'skeleton'
  | 'nervousSystem'
  | 'circulatorySystem'
  | 'legs'
  | 'operatingSystem'

export type CyberwareSheetRarity = 'standard' | 'rare' | 'epic' | 'prototype'

export interface CyberwareSheetSlot {
  id: string
  name: string
  icon?: string
  rarity?: CyberwareSheetRarity
}

export interface CyberwareSheetZoneDefinition {
  id: CyberwareSheetZoneId
  fieldKey: string
  label: string
  side: 'left' | 'right'
  left: number
  top: number
  width: number
  height: number
  maxSlots: number
}

export const cyberwareSheetZones: CyberwareSheetZoneDefinition[] = [
  { id: 'frontalCortex',     fieldKey: 'P4_FRONTAL_CORTEX',     label: 'CORTEX',              side: 'left',  left: 0, top: 0, width: 0, height: 0, maxSlots: 2 },
  { id: 'skeleton',          fieldKey: 'P4_SKELETON',            label: 'ESQUELETO',           side: 'left',  left: 0, top: 0, width: 0, height: 0, maxSlots: 2 },
  { id: 'nervousSystem',     fieldKey: 'P4_NERVOUS_SYSTEM',      label: 'SISTEMA NERVOSO',     side: 'left',  left: 0, top: 0, width: 0, height: 0, maxSlots: 2 },
  { id: 'legs',              fieldKey: 'P4_LEGS',                label: 'PERNAS/PES',          side: 'left',  left: 0, top: 0, width: 0, height: 0, maxSlots: 2 },
  { id: 'operatingSystem',   fieldKey: 'P4_OPERATING_SYSTEM',    label: 'SISTEMA OPERATIVO',   side: 'right', left: 0, top: 0, width: 0, height: 0, maxSlots: 2 },
  { id: 'eyes',              fieldKey: 'P4_EYES',                label: 'CARA',                side: 'right', left: 0, top: 0, width: 0, height: 0, maxSlots: 2 },
  { id: 'arms',              fieldKey: 'P4_ARMS',                label: 'BRACOS/MAOS',         side: 'right', left: 0, top: 0, width: 0, height: 0, maxSlots: 2 },
  { id: 'circulatorySystem', fieldKey: 'P4_CIRCULATORY_SYSTEM',  label: 'SISTEMA CIRCULATORIO',side: 'right', left: 0, top: 0, width: 0, height: 0, maxSlots: 2 },
] as const

export const cyberwareSheetFieldKeys = cyberwareSheetZones.map((zone) => zone.fieldKey)

export const cyberwareSheetFieldDefaults = Object.fromEntries(
  cyberwareSheetFieldKeys.map((key) => [key, '[]']),
) as Record<string, string>

const validRarities = new Set<CyberwareSheetRarity>(['standard', 'rare', 'epic', 'prototype'])

export function createCyberwareSheetSlot(): CyberwareSheetSlot {
  return {
    id: `cw-${crypto.randomUUID()}`,
    name: '',
    icon: '',
    rarity: 'standard',
  }
}

export function parseCyberwareSheetSlots(value: string | undefined): CyberwareSheetSlot[] {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return []
      }

      const slot = entry as Record<string, unknown>
      const rarity = typeof slot.rarity === 'string' && validRarities.has(slot.rarity as CyberwareSheetRarity)
        ? (slot.rarity as CyberwareSheetRarity)
        : 'standard'

      return [{
        id: typeof slot.id === 'string' && slot.id.trim() ? slot.id : `cw-${crypto.randomUUID()}`,
        name: typeof slot.name === 'string' ? slot.name : '',
        icon: typeof slot.icon === 'string' ? slot.icon : '',
        rarity,
      }]
    })
  } catch {
    return []
  }
}

export function stringifyCyberwareSheetSlots(slots: CyberwareSheetSlot[]) {
  return JSON.stringify(slots)
}
