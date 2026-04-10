import type { CSSProperties } from 'react'
import type { CyberwareSheetSlot, CyberwareSheetZoneDefinition } from '../../lib/cyberwareSheetLayout'
import { CyberwareAddSlot, CyberwareSlot } from './CyberwareSlot'

interface CyberwareZoneProps {
  zone: CyberwareSheetZoneDefinition
  slots: CyberwareSheetSlot[]
  canEdit: boolean
  onAddSlot: () => void
  onRemoveSlot: (slotId: string) => void
}

export function CyberwareZone({ zone, slots, canEdit, onAddSlot, onRemoveSlot }: CyberwareZoneProps) {
  const [first, second] = slots.slice(0, zone.maxSlots)
  const canAdd = canEdit && slots.length < zone.maxSlots

  const style: CSSProperties = {
    position: 'absolute',
    left: `${zone.left}%`,
    top: `${zone.top}%`,
    width: `${zone.width}%`,
    textAlign: 'center',
  }

  return (
    <section className="pointer-events-auto" style={style}>
      {/* Label — matches the sheet header style */}
      <p
        className="font-display uppercase text-[#0da7ff]"
        style={{
          fontSize: '0.55rem',
          letterSpacing: '0.2em',
          textShadow: '0 0 7px rgba(13,167,255,0.5)',
          marginBottom: '6px',
          whiteSpace: 'nowrap',
        }}
      >
        {zone.label}
      </p>

      {/* Slot row */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', alignItems: 'center' }}>
        {/* Slot 1 */}
        <CyberwareSlot
          filled={Boolean(first)}
          canEdit={canEdit}
          onRemove={first ? () => onRemoveSlot(first.id) : undefined}
        />

        {/* Slot 2 or add-button */}
        {second ? (
          <CyberwareSlot filled canEdit={canEdit} onRemove={() => onRemoveSlot(second.id)} />
        ) : canAdd && first ? (
          <CyberwareAddSlot onClick={onAddSlot} />
        ) : null}

        {/* Add button when completely empty */}
        {!first && canAdd ? (
          <CyberwareAddSlot onClick={onAddSlot} />
        ) : null}
      </div>
    </section>
  )
}
