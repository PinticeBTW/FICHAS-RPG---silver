import { useMemo, useState } from 'react'
import { cyberwaresByGroup } from '../../data/cyberwares'
import { buildEquippedCyberwareState, updateEquippedCyberwareSlots } from '../../lib/cyberwareState'
import { calculateCyberwareTotals } from '../../lib/cyberwareTotals'
import {
  CYBERWARE_CYBER_MAX_FIELD_KEY,
  CYBERWARE_SHIELD_MAX_FIELD_KEY,
  cyberwareSheetZones,
  normalizeCyberwareSheetSlots,
  stringifyCyberwareSheetSlots,
} from '../../lib/cyberwareSheetLayout'
import type { SelectedSlot } from '../../types/cyberware'
import { CyberwarePicker } from './CyberwarePicker'
import { CyberwareSlot, type CwColors } from './CyberwareSlot'
import { CyberwareTotals } from './CyberwareTotals'

export type CwTone = 'blue' | 'red' | 'grey'

const CW_COLORS: Record<CwTone, CwColors> = {
  blue: {
    accent: '#0da7ff',
    faint: 'rgba(13,167,255,0.18)',
    dim: 'rgba(13,167,255,0.08)',
    glowFilter: 'drop-shadow(0 0 5px rgba(13,167,255,0.65))',
  },
  red: {
    accent: '#cc1111',
    faint: 'rgba(204,17,17,0.28)',
    dim: 'rgba(204,17,17,0.10)',
    glowFilter: 'drop-shadow(0 0 5px rgba(204,17,17,0.7))',
  },
  grey: {
    accent: '#c0c5cc',
    faint: 'rgba(192,197,204,0.28)',
    dim: 'rgba(192,197,204,0.10)',
    glowFilter: 'drop-shadow(0 0 4px rgba(192,197,204,0.55))',
  },
}

interface CyberwareBoardProps {
  fieldData: Record<string, string>
  onFieldChange: (fieldName: string, value: string) => void
  canEdit: boolean
  tone?: CwTone
}

export function CyberwareBoard({
  fieldData,
  onFieldChange,
  canEdit,
  tone = 'blue',
}: CyberwareBoardProps) {
  const colors = CW_COLORS[tone]
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot>(null)

  const equippedCyberware = useMemo(() => buildEquippedCyberwareState(fieldData), [fieldData])
  const totals = useMemo(() => calculateCyberwareTotals(equippedCyberware), [equippedCyberware])

  const zoneById = useMemo(
    () => Object.fromEntries(cyberwareSheetZones.map((zone) => [zone.id, zone])),
    [],
  )

  const selectedZone = selectedSlot ? zoneById[selectedSlot.groupId] : null
  const selectedCyberware = selectedSlot ? equippedCyberware[selectedSlot.groupId][selectedSlot.slotIndex] : null
  const compatibleCyberwares = selectedSlot ? cyberwaresByGroup[selectedSlot.groupId] : []

  const handleEquipCyberware = (cyberwareId: string) => {
    if (!selectedSlot || !selectedZone) {
      return
    }

    const nextSlots = normalizeCyberwareSheetSlots(fieldData[selectedZone.fieldKey], selectedZone.maxSlots)
    const updatedSlots = updateEquippedCyberwareSlots(nextSlots, selectedSlot.slotIndex, cyberwareId)

    onFieldChange(selectedZone.fieldKey, stringifyCyberwareSheetSlots(updatedSlots))
    setSelectedSlot(null)
  }

  const handleRemoveCyberware = () => {
    if (!selectedSlot || !selectedZone) {
      return
    }

    const nextSlots = normalizeCyberwareSheetSlots(fieldData[selectedZone.fieldKey], selectedZone.maxSlots)
    const updatedSlots = updateEquippedCyberwareSlots(nextSlots, selectedSlot.slotIndex, null)

    onFieldChange(selectedZone.fieldKey, stringifyCyberwareSheetSlots(updatedSlots))
  }

  return (
    <div className="pointer-events-none absolute inset-0" style={{ padding: '1% 3% 1%' }}>
      {cyberwareSheetZones.flatMap((zone) =>
        zone.slotBoxes.map((slotBox, slotIndex) => (
          <div
            key={`${zone.id}-${slotIndex}`}
            className="pointer-events-auto absolute flex items-center justify-center"
            style={{
              left: `${slotBox.left}%`,
              top: `${slotBox.top}%`,
              width: `${slotBox.width}%`,
              height: `${slotBox.height}%`,
            }}
          >
            <CyberwareSlot
              cyberware={equippedCyberware[zone.id][slotIndex]}
              selected={selectedSlot?.groupId === zone.id && selectedSlot.slotIndex === slotIndex}
              canEdit={canEdit}
              colors={colors}
              onClick={canEdit ? () => setSelectedSlot({ groupId: zone.id, slotIndex }) : undefined}
            />
          </div>
        )),
      )}

      <CyberwareTotals
        totals={totals}
        colors={colors}
        canEdit={canEdit}
        cyberMaxValue={fieldData[CYBERWARE_CYBER_MAX_FIELD_KEY] ?? ''}
        shieldMaxValue={fieldData[CYBERWARE_SHIELD_MAX_FIELD_KEY] ?? ''}
        onCyberMaxChange={(value) => onFieldChange(CYBERWARE_CYBER_MAX_FIELD_KEY, value)}
        onShieldMaxChange={(value) => onFieldChange(CYBERWARE_SHIELD_MAX_FIELD_KEY, value)}
      />

      {selectedSlot && selectedZone ? (
        <CyberwarePicker
          groupId={selectedSlot.groupId}
          groupLabel={selectedZone.label}
          slotIndex={selectedSlot.slotIndex}
          currentCyberware={selectedCyberware}
          compatibleCyberwares={compatibleCyberwares}
          colors={colors}
          onClose={() => setSelectedSlot(null)}
          onEquip={(cyberware) => handleEquipCyberware(cyberware.id)}
          onRemove={handleRemoveCyberware}
        />
      ) : null}
    </div>
  )
}
