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
    maxSlots: 2,
    slotBoxes: [
      { left: 6.0, top: 11.778, width: 9.053, height: 6.455 },
      { left: 18.211, top: 11.778, width: 9.053, height: 6.455 },
    ],
  },
  {
    id: 'skeleton',
    fieldKey: 'P4_SKELETON',
    label: 'ESQUELETO',
    side: 'left',
    maxSlots: 2,
    slotBoxes: [
      { left: 6.211, top: 33.111, width: 9.053, height: 6.455 },
      { left: 18.421, top: 33.111, width: 9.053, height: 6.455 },
    ],
  },
  {
    id: 'nervousSystem',
    fieldKey: 'P4_NERVOUS_SYSTEM',
    label: 'SISTEMA NERVOSO',
    side: 'left',
    maxSlots: 2,
    slotBoxes: [
      { left: 5.368, top: 52.815, width: 9.053, height: 6.455 },
      { left: 17.579, top: 52.815, width: 9.053, height: 6.455 },
    ],
  },
  {
    id: 'legsFeet',
    fieldKey: 'P4_LEGS',
    label: 'PERNAS/PES',
    side: 'left',
    maxSlots: 2,
    slotBoxes: [
      { left: 6.211, top: 81.407, width: 9.053, height: 6.455 },
      { left: 18.421, top: 81.407, width: 9.053, height: 6.455 },
    ],
  },
  {
    id: 'operatingSystem',
    fieldKey: 'P4_OPERATING_SYSTEM',
    label: 'SISTEMA OPERATIVO',
    side: 'right',
    maxSlots: 2,
    slotBoxes: [
      { left: 72.316, top: 11.778, width: 9.053, height: 6.455 },
      { left: 84.526, top: 11.778, width: 9.053, height: 6.455 },
    ],
  },
  {
    id: 'face',
    fieldKey: 'P4_EYES',
    label: 'CARA',
    side: 'right',
    maxSlots: 2,
    slotBoxes: [
      { left: 72.316, top: 32.815, width: 9.053, height: 6.455 },
      { left: 84.526, top: 32.815, width: 9.053, height: 6.455 },
    ],
  },
  {
    id: 'armsHands',
    fieldKey: 'P4_ARMS',
    label: 'BRACOS/MAOS',
    side: 'right',
    maxSlots: 2,
    slotBoxes: [
      { left: 72.737, top: 52.815, width: 9.053, height: 6.455 },
      { left: 84.947, top: 52.815, width: 9.053, height: 6.455 },
    ],
  },
  {
    id: 'circulatorySystem',
    fieldKey: 'P4_CIRCULATORY_SYSTEM',
    label: 'SISTEMA CIRCULATORIO',
    side: 'right',
    maxSlots: 2,
    slotBoxes: [
      { left: 72.737, top: 81.407, width: 9.053, height: 6.455 },
      { left: 84.947, top: 81.407, width: 9.053, height: 6.455 },
    ],
  },
] as const

export const CYBERWARE_CYBER_MAX_FIELD_KEY = 'P4_CYBER_MAX'
export const CYBERWARE_SHIELD_MAX_FIELD_KEY = 'P4_SHIELD_MAX'
export const CYBERWARE_DEFAULT_METER_MAX = 60

const cyberwareZoneFieldKeys = cyberwareSheetZones.map((zone) => zone.fieldKey)

export const cyberwareSheetFieldKeys = [
  ...cyberwareZoneFieldKeys,
  CYBERWARE_CYBER_MAX_FIELD_KEY,
  CYBERWARE_SHIELD_MAX_FIELD_KEY,
] as const

export const cyberwareSheetFieldDefaults = {
  ...Object.fromEntries(cyberwareZoneFieldKeys.map((key) => [key, '[]'])),
  [CYBERWARE_CYBER_MAX_FIELD_KEY]: '',
  [CYBERWARE_SHIELD_MAX_FIELD_KEY]: '',
} as Record<string, string>

export const cyberwareSheetMeters: CyberwareSheetMeterDefinition = {
  cyber: [
    { left: 8.0761, top: 91.8821, width: 2.7263, height: 1.8683 },
    { left: 11.0158, top: 91.8498, width: 2.7263, height: 1.8683 },
    { left: 13.8637, top: 91.8175, width: 2.7263, height: 1.8683 },
    { left: 16.8034, top: 91.7852, width: 2.7263, height: 1.8683 },
    { left: 19.6972, top: 91.7852, width: 2.7262, height: 1.8683 },
    { left: 22.6827, top: 91.7852, width: 2.7263, height: 1.8683 },
    { left: 8.122, top: 94.064, width: 2.7263, height: 1.8683 },
    { left: 11.0617, top: 94.0316, width: 2.7263, height: 1.8683 },
    { left: 13.9096, top: 93.9993, width: 2.7263, height: 1.8683 },
    { left: 16.8493, top: 93.967, width: 2.7263, height: 1.8683 },
    { left: 19.7431, top: 93.967, width: 2.7264, height: 1.8683 },
    { left: 22.7288, top: 93.967, width: 2.7261, height: 1.8683 },
  ],
  shield: [
    { left: 74.564, top: 91.6475, width: 2.7263, height: 1.8683 },
    { left: 77.5036, top: 91.6152, width: 2.7263, height: 1.8683 },
    { left: 80.3516, top: 91.5828, width: 2.7263, height: 1.8683 },
    { left: 83.2912, top: 91.5505, width: 2.7263, height: 1.8683 },
    { left: 86.1851, top: 91.5505, width: 2.7263, height: 1.8683 },
    { left: 89.1707, top: 91.5505, width: 2.7263, height: 1.8683 },
    { left: 74.6099, top: 93.8293, width: 2.7263, height: 1.8683 },
    { left: 77.5497, top: 93.797, width: 2.7261, height: 1.8683 },
    { left: 80.3975, top: 93.7647, width: 2.7263, height: 1.8683 },
    { left: 83.3371, top: 93.7323, width: 2.7263, height: 1.8683 },
    { left: 86.2309, top: 93.7323, width: 2.7263, height: 1.8683 },
    { left: 89.2166, top: 93.7323, width: 2.7263, height: 1.8683 },
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
