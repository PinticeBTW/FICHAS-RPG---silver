import { useMemo, useState } from 'react'
import {
  buildSheetCyberwareCatalogById,
  buildSheetCyberwaresByGroup,
  canProfileEquipCyberware,
  canProfileViewCyberware,
  createHiddenCyberwarePlaceholder,
  parseSheetCyberwareCatalog,
} from '../../lib/cyberwareCatalog'
import { buildEquippedCyberwareState, updateEquippedCyberwareSlots } from '../../lib/cyberwareState'
import { calculateCyberwareTotals } from '../../lib/cyberwareTotals'
import {
  CYBERWARE_CATALOG_FIELD_KEY,
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
  viewerRole?: 'gm' | 'owner' | 'shared'
  viewerProfileId?: string | null
}

export function CyberwareBoard({
  fieldData,
  onFieldChange,
  canEdit,
  tone = 'blue',
  viewerRole = 'shared',
  viewerProfileId = null,
}: CyberwareBoardProps) {
  const colors = CW_COLORS[tone]
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot>(null)
  const isGmViewer = viewerRole === 'gm'
  const isOwnerViewer = viewerRole === 'owner'

  const sheetCyberwareCatalog = useMemo(
    () => parseSheetCyberwareCatalog(fieldData[CYBERWARE_CATALOG_FIELD_KEY]),
    [fieldData],
  )
  const cyberwareCatalogById = useMemo(
    () => buildSheetCyberwareCatalogById(sheetCyberwareCatalog),
    [sheetCyberwareCatalog],
  )
  const cyberwaresByGroup = useMemo(
    () => buildSheetCyberwaresByGroup(sheetCyberwareCatalog),
    [sheetCyberwareCatalog],
  )
  const equippedCyberware = useMemo(
    () => buildEquippedCyberwareState(fieldData, cyberwareCatalogById),
    [cyberwareCatalogById, fieldData],
  )
  const totals = useMemo(() => calculateCyberwareTotals(equippedCyberware), [equippedCyberware])

  const zoneById = useMemo(
    () => Object.fromEntries(cyberwareSheetZones.map((zone) => [zone.id, zone])),
    [],
  )

  const canOpenSlot = (groupId: keyof typeof cyberwaresByGroup, slotIndex: number) => {
    if (!canEdit) {
      return false
    }

    if (isGmViewer) {
      return true
    }

    if (!isOwnerViewer) {
      return false
    }

    const currentCyberware = equippedCyberware[groupId][slotIndex]

    if (currentCyberware) {
      return canProfileViewCyberware(currentCyberware, viewerProfileId)
    }

    return cyberwaresByGroup[groupId].some((entry) => canProfileEquipCyberware(entry, viewerProfileId))
  }

  const activeSelectedSlot =
    selectedSlot && canOpenSlot(selectedSlot.groupId, selectedSlot.slotIndex)
      ? selectedSlot
      : null
  const selectedZone = activeSelectedSlot ? zoneById[activeSelectedSlot.groupId] : null
  const selectedEquippedCyberware =
    activeSelectedSlot ? equippedCyberware[activeSelectedSlot.groupId][activeSelectedSlot.slotIndex] : null
  const selectedCyberware =
    activeSelectedSlot && selectedEquippedCyberware && !isGmViewer && !canProfileViewCyberware(selectedEquippedCyberware, viewerProfileId)
      ? createHiddenCyberwarePlaceholder(activeSelectedSlot.groupId)
      : selectedEquippedCyberware
  const compatibleCyberwares = activeSelectedSlot
    ? cyberwaresByGroup[activeSelectedSlot.groupId].filter((entry) => isGmViewer || canProfileViewCyberware(entry, viewerProfileId))
    : []

  const handleEquipCyberware = (cyberwareId: string) => {
    if (!activeSelectedSlot || !selectedZone) {
      return
    }

    const targetCyberware = cyberwaresByGroup[activeSelectedSlot.groupId].find((entry) => entry.id === cyberwareId)

    if (!targetCyberware) {
      return
    }

    if (!isGmViewer && !canProfileEquipCyberware(targetCyberware, viewerProfileId)) {
      return
    }

    const nextSlots = normalizeCyberwareSheetSlots(fieldData[selectedZone.fieldKey], selectedZone.maxSlots)
    const updatedSlots = updateEquippedCyberwareSlots(nextSlots, activeSelectedSlot.slotIndex, cyberwareId)

    onFieldChange(selectedZone.fieldKey, stringifyCyberwareSheetSlots(updatedSlots))
    setSelectedSlot(null)
  }

  const handleRemoveCyberware = () => {
    if (!activeSelectedSlot || !selectedZone) {
      return
    }

    const currentCyberware = equippedCyberware[activeSelectedSlot.groupId][activeSelectedSlot.slotIndex]

    if (!isGmViewer && !canProfileEquipCyberware(currentCyberware, viewerProfileId)) {
      return
    }

    const nextSlots = normalizeCyberwareSheetSlots(fieldData[selectedZone.fieldKey], selectedZone.maxSlots)
    const updatedSlots = updateEquippedCyberwareSlots(nextSlots, activeSelectedSlot.slotIndex, null)

    onFieldChange(selectedZone.fieldKey, stringifyCyberwareSheetSlots(updatedSlots))
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {cyberwareSheetZones.flatMap((zone) =>
        zone.slotBoxes.map((slotBox, slotIndex) => (
          (() => {
            const slotCanOpen = canOpenSlot(zone.id, slotIndex)
            const slotCyberware = equippedCyberware[zone.id][slotIndex]
            const displayedCyberware =
              slotCyberware && !isGmViewer && !canProfileViewCyberware(slotCyberware, viewerProfileId)
                ? createHiddenCyberwarePlaceholder(zone.id)
                : slotCyberware

            return (
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
              cyberware={displayedCyberware}
              selected={activeSelectedSlot?.groupId === zone.id && activeSelectedSlot.slotIndex === slotIndex}
              canEdit={slotCanOpen}
              colors={colors}
              onClick={slotCanOpen ? () => setSelectedSlot({ groupId: zone.id, slotIndex }) : undefined}
            />
          </div>
            )
          })()
        )),
      )}

      <CyberwareTotals
        totals={totals}
        colors={colors}
        canEdit={isGmViewer}
        cyberMaxValue={fieldData[CYBERWARE_CYBER_MAX_FIELD_KEY] ?? ''}
        shieldMaxValue={fieldData[CYBERWARE_SHIELD_MAX_FIELD_KEY] ?? ''}
        onCyberMaxChange={(value) => onFieldChange(CYBERWARE_CYBER_MAX_FIELD_KEY, value)}
        onShieldMaxChange={(value) => onFieldChange(CYBERWARE_SHIELD_MAX_FIELD_KEY, value)}
      />

      {activeSelectedSlot && selectedZone ? (
        <CyberwarePicker
          groupId={activeSelectedSlot.groupId}
          groupLabel={selectedZone.label}
          slotIndex={activeSelectedSlot.slotIndex}
          currentCyberware={selectedCyberware}
          compatibleCyberwares={compatibleCyberwares}
          colors={colors}
          isGmViewer={isGmViewer}
          canEquipCyberware={(cyberware) => isGmViewer || canProfileEquipCyberware(cyberware, viewerProfileId)}
          canRemoveCurrentCyberware={isGmViewer || canProfileEquipCyberware(selectedEquippedCyberware, viewerProfileId)}
          onClose={() => setSelectedSlot(null)}
          onEquip={(cyberware) => handleEquipCyberware(cyberware.id)}
          onRemove={handleRemoveCyberware}
        />
      ) : null}
    </div>
  )
}
