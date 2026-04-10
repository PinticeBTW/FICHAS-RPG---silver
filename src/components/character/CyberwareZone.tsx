import type { CSSProperties } from 'react'
import {
  type CyberwareSheetSlot,
  type CyberwareSheetZoneDefinition,
} from '../../lib/cyberwareSheetLayout'
import { CyberwareAddSlot, CyberwareSlot } from './CyberwareSlot'

interface CyberwareZoneProps {
  zone: CyberwareSheetZoneDefinition
  slots: CyberwareSheetSlot[]
  canEdit: boolean
  onAddSlot: () => void
  onRemoveSlot: (slotId: string) => void
}

function buildZoneStyle(zone: CyberwareSheetZoneDefinition): CSSProperties {
  return {
    left: `${zone.left}%`,
    top: `${zone.top}%`,
    width: `${zone.width}%`,
  }
}

export function CyberwareZone({
  zone,
  slots,
  canEdit,
  onAddSlot,
  onRemoveSlot,
}: CyberwareZoneProps) {
  const limitedSlots = slots.slice(0, zone.maxSlots)
  const [first, second] = limitedSlots
  const canAdd = canEdit && limitedSlots.length < zone.maxSlots

  return (
    <section className="pointer-events-auto absolute" style={buildZoneStyle(zone)}>
      {/* Label */}
      <p
        className="text-center font-display uppercase text-[#0dd4ff]"
        style={{
          fontSize: '0.6rem',
          letterSpacing: '0.18em',
          textShadow: '0 0 8px rgba(0,210,255,0.45)',
          whiteSpace: 'nowrap',
        }}
      >
        {zone.label}
      </p>

      {/* Slots row */}
      <div className="mt-1.5 flex items-center justify-center gap-1">
        {/* Slot 1: always shown — filled if has data, else empty placeholder */}
        <CyberwareSlot
          filled={Boolean(first)}
          canEdit={canEdit}
          onRemove={first ? () => onRemoveSlot(first.id) : undefined}
        />

        {/* Slot 2: shown when filled OR as add-button placeholder */}
        {second ? (
          <CyberwareSlot
            filled
            canEdit={canEdit}
            onRemove={() => onRemoveSlot(second.id)}
          />
        ) : canAdd && first ? (
          /* Show add-slot as dashed circle only after first slot is filled */
          <CyberwareAddSlot onClick={onAddSlot} />
        ) : null}

        {/* Add button when first slot is empty and nothing else */}
        {!first && canAdd ? (
          <CyberwareAddSlot onClick={onAddSlot} />
        ) : null}
      </div>
    </section>
  )
}
