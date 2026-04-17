import { cyberwareCatalogById } from '../data/cyberwares'
import { cyberwareSheetZones, normalizeCyberwareSheetSlots } from './cyberwareSheetLayout'
import type {
  Cyberware,
  CyberwareGroupId,
  EquippedCyberwareState,
  EquippedCyberwareSlotData,
} from '../types/cyberware'

export function createInitialEquippedCyberwareState(): EquippedCyberwareState {
  return Object.fromEntries(
    cyberwareSheetZones.map((zone) => [zone.id, Array.from({ length: zone.maxSlots }, () => null)]),
  ) as EquippedCyberwareState
}

export function buildEquippedCyberwareState(fieldData: Record<string, string>): EquippedCyberwareState {
  const initialState = createInitialEquippedCyberwareState()

  for (const zone of cyberwareSheetZones) {
    initialState[zone.id] = normalizeCyberwareSheetSlots(fieldData[zone.fieldKey], zone.maxSlots)
      .map((slot): Cyberware | null => {
        if (!slot?.cyberwareId) {
          return null
        }

        return cyberwareCatalogById[slot.cyberwareId] ?? null
      })
  }

  return initialState
}

export function updateEquippedCyberwareSlots(
  slots: (EquippedCyberwareSlotData | null)[],
  slotIndex: number,
  cyberwareId: string | null,
): (EquippedCyberwareSlotData | null)[] {
  const nextSlots = [...slots]
  nextSlots[slotIndex] = cyberwareId ? { cyberwareId } : null
  return nextSlots
}

export function getZoneFieldKey(groupId: CyberwareGroupId) {
  return cyberwareSheetZones.find((zone) => zone.id === groupId)?.fieldKey ?? null
}
