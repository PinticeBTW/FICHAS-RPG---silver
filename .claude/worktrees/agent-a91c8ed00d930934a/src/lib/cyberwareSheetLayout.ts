import type { CyberwareGroupId, EquippedCyberwareSlotData } from '../types/cyberware'

export interface CyberwareSheetZoneDefinition {
  id: CyberwareGroupId
  fieldKey: string
  label: string
  side: 'left' | 'right'
  maxSlots: number
  slotBoxes: readonly CyberwareSheetSlotBox[]
}

export interface CyberwareSheetSlotBox {
  left: number
  top: number
  width: number
  height: number
}

export interface CyberwareSheetMeterDefinition {
  cyber: readonly CyberwareSheetSlotBox[]
  shield: readonly CyberwareSheetSlotBox[]
}

export interface CyberwareSheetMeterLimitDefinition {
  cyber: CyberwareSheetSlotBox
  shield: CyberwareSheetSlotBox
}

export const cyberwareSheetZones: CyberwareSheetZoneDefinition[] = [
  {
    id: 'cortex',
    fieldKey: 'P4_FRONTAL_CORTEX',
    label: 'CORTEX',
    side: 'left',
    maxSlots: 3,
    slotBoxes: [
      { left: 7.6146, top: 11.6297, width: 6.2764, height: 6.8994 },
      { left: 15.4313, top: 11.6297, width: 6.2764, height: 6.8994 },
      { left: 23.2480, top: 11.6297, width: 6.2764, height: 6.8994 },
    ],
  },
  {
    id: 'skeleton',
    fieldKey: 'P4_SKELETON',
    label: 'ESQUELETO',
    side: 'left',
    maxSlots: 3,
    slotBoxes: [
      { left: 7.6146, top: 29.7038, width: 6.2764, height: 6.8994 },
      { left: 15.4313, top: 29.7038, width: 6.2764, height: 6.8994 },
      { left: 23.2480, top: 29.7038, width: 6.2764, height: 6.8994 },
    ],
  },
  {
    id: 'nervousSystem',
    fieldKey: 'P4_NERVOUS_SYSTEM',
    label: 'SISTEMA NERVOSO',
    side: 'left',
    maxSlots: 3,
    slotBoxes: [
      { left: 7.6146, top: 48.6667, width: 6.2764, height: 6.8994 },
      { left: 15.4313, top: 48.6667, width: 6.2764, height: 6.8994 },
      { left: 23.2480, top: 48.6667, width: 6.2764, height: 6.8994 },
    ],
  },
  {
    id: 'legsFeet',
    fieldKey: 'P4_LEGS',
    label: 'PERNAS/PES',
    side: 'left',
    maxSlots: 2,
    slotBoxes: [
      { left: 11.5229, top: 65.5556, width: 6.2764, height: 6.8994 },
      { left: 19.3396, top: 65.5556, width: 6.2764, height: 6.8994 },
    ],
  },
  {
    id: 'operatingSystem',
    fieldKey: 'P4_OPERATING_SYSTEM',
    label: 'SISTEMA OPERATIVO',
    side: 'right',
    maxSlots: 1,
    slotBoxes: [
      { left: 78.6388, top: 12.2223, width: 6.2764, height: 6.8994 },
    ],
  },
  {
    id: 'face',
    fieldKey: 'P4_EYES',
    label: 'CARA',
    side: 'right',
    maxSlots: 2,
    slotBoxes: [
      { left: 74.7305, top: 29.2593, width: 6.2764, height: 6.8994 },
      { left: 82.5472, top: 29.2593, width: 6.2764, height: 6.8994 },
    ],
  },
  {
    id: 'armsHands',
    fieldKey: 'P4_ARMS',
    label: 'BRACOS/MAOS',
    side: 'right',
    maxSlots: 2,
    slotBoxes: [
      { left: 74.7305, top: 48.2223, width: 6.2764, height: 6.8994 },
      { left: 82.5472, top: 48.2223, width: 6.2764, height: 6.8994 },
    ],
  },
  {
    id: 'circulatorySystem',
    fieldKey: 'P4_CIRCULATORY_SYSTEM',
    label: 'SISTEMA CIRCULATORIO',
    side: 'right',
    maxSlots: 3,
    slotBoxes: [
      { left: 71.0916, top: 65.8519, width: 6.2764, height: 6.8994 },
      { left: 78.9084, top: 65.8519, width: 6.2764, height: 6.8994 },
      { left: 86.7251, top: 65.8519, width: 6.2764, height: 6.8994 },
    ],
  },
] as const

export const CYBERWARE_CYBER_MAX_FIELD_KEY = 'P4_CYBER_MAX'
export const CYBERWARE_SHIELD_MAX_FIELD_KEY = 'P4_SHIELD_MAX'
export const CYBERWARE_CATALOG_FIELD_KEY = 'P4_CYBERWARE_CATALOG'
export const CYBERWARE_DEFAULT_METER_MAX = 60

const cyberwareZoneFieldKeys = cyberwareSheetZones.map((zone) => zone.fieldKey)

export const cyberwareSheetFieldKeys = [
  ...cyberwareZoneFieldKeys,
  CYBERWARE_CYBER_MAX_FIELD_KEY,
  CYBERWARE_SHIELD_MAX_FIELD_KEY,
  CYBERWARE_CATALOG_FIELD_KEY,
] as const

export const cyberwareSheetFieldDefaults = {
  ...Object.fromEntries(cyberwareZoneFieldKeys.map((key) => [key, '[]'])),
  [CYBERWARE_CYBER_MAX_FIELD_KEY]: '',
  [CYBERWARE_SHIELD_MAX_FIELD_KEY]: '',
  [CYBERWARE_CATALOG_FIELD_KEY]: '[]',
} as Record<string, string>

export const cyberwareSheetMeters: CyberwareSheetMeterDefinition = {
  cyber: [
    { left: 9.2992, top: 89.1113, width: 2.7263, height: 3.1375 },
    { left: 12.3894, top: 89.1113, width: 2.7263, height: 3.1375 },
    { left: 15.4796, top: 89.1113, width: 2.7263, height: 3.1375 },
    { left: 18.5697, top: 89.1113, width: 2.7263, height: 3.1375 },
    { left: 21.6599, top: 89.1113, width: 2.7263, height: 3.1375 },
    { left: 24.7501, top: 89.1113, width: 2.7263, height: 3.1375 },
    { left: 9.2992, top: 92.9014, width: 2.7263, height: 3.1375 },
    { left: 12.3894, top: 92.9014, width: 2.7263, height: 3.1375 },
    { left: 15.4796, top: 92.9014, width: 2.7263, height: 3.1375 },
    { left: 18.5697, top: 92.9014, width: 2.7263, height: 3.1375 },
    { left: 21.6599, top: 92.9014, width: 2.7263, height: 3.1375 },
    { left: 24.7501, top: 92.9014, width: 2.7263, height: 3.1375 },
  ],
  shield: [
    { left: 72.7763, top: 89.1113, width: 2.7263, height: 3.1375 },
    { left: 75.8665, top: 89.1113, width: 2.7263, height: 3.1375 },
    { left: 78.9567, top: 89.1113, width: 2.7263, height: 3.1375 },
    { left: 82.0468, top: 89.1113, width: 2.7263, height: 3.1375 },
    { left: 85.137, top: 89.1113, width: 2.7263, height: 3.1375 },
    { left: 88.2272, top: 89.1113, width: 2.7263, height: 3.1375 },
    { left: 72.7763, top: 92.9014, width: 2.7263, height: 3.1375 },
    { left: 75.8665, top: 92.9014, width: 2.7263, height: 3.1375 },
    { left: 78.9567, top: 92.9014, width: 2.7263, height: 3.1375 },
    { left: 82.0468, top: 92.9014, width: 2.7263, height: 3.1375 },
    { left: 85.137, top: 92.9014, width: 2.7263, height: 3.1375 },
    { left: 88.2272, top: 92.9014, width: 2.7263, height: 3.1375 },
  ],
} as const

export const cyberwareSheetMeterLimits: CyberwareSheetMeterLimitDefinition = {
  cyber: { left: 35.7895, top: 91.8519, width: 5.4737, height: 2.3704 },
  shield: { left: 56.8421, top: 91.8519, width: 5.4737, height: 2.3704 },
} as const

export function parseCyberwareSheetSlots(value: string | undefined): (EquippedCyberwareSlotData | null)[] {
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

      if (typeof slot.cyberwareId === 'string' && slot.cyberwareId.trim()) {
        return [{ cyberwareId: slot.cyberwareId }]
      }

      if (typeof slot.name === 'string' && slot.name.trim()) {
        return [null]
      }

      return [null]
    })
  } catch {
    return []
  }
}

export function normalizeCyberwareSheetSlots(value: string | undefined, maxSlots: number) {
  const parsedSlots = parseCyberwareSheetSlots(value)
  return Array.from({ length: maxSlots }, (_, index) => parsedSlots[index] ?? null)
}

export function stringifyCyberwareSheetSlots(slots: (EquippedCyberwareSlotData | null)[]) {
  return JSON.stringify(slots)
}
