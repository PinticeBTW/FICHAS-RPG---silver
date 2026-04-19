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

export function buildEquippedCyberwareState(
  fieldData: Record<string, string>,
  cyberwareCatalogById: Record<string, Cyberware>,
): EquippedCyberwareState {
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

export function removeCyberwareFromEquippedFieldData(
  fieldData: Record<string, string>,
  cyberwareId: string,
) {
  return Object.fromEntries(
    cyberwareSheetZones.flatMap((zone) => {
      const nextSlots = normalizeCyberwareSheetSlots(fieldData[zone.fieldKey], zone.maxSlots)
      const updatedSlots = nextSlots.map((slot) =>
        slot?.cyberwareId === cyberwareId ? null : slot,
      )

      const hasChanged = updatedSlots.some(
        (slot, index) => slot?.cyberwareId !== nextSlots[index]?.cyberwareId,
      )

      return hasChanged ? [[zone.fieldKey, JSON.stringify(updatedSlots)]] : []
    }),
  ) as Record<string, string>
}
