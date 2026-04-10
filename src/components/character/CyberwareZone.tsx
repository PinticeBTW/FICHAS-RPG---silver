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
  const isLeft = zone.side === 'left'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isLeft ? 'flex-end' : 'flex-start', gap: '5px' }}>
      {/* Label */}
      <p
        className="font-display uppercase text-[#0da7ff]"
        style={{
          fontSize: '0.58rem',
          letterSpacing: '0.22em',
          textShadow: '0 0 8px rgba(13,167,255,0.55)',
          whiteSpace: 'nowrap',
        }}
      >
        {zone.label}
      </p>

      {/* Slots */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexDirection: isLeft ? 'row-reverse' : 'row' }}>
        {/* Always show slot 1 */}
        <CyberwareSlot
          filled={Boolean(first)}
          canEdit={canEdit}
          onRemove={first ? () => onRemoveSlot(first.id) : undefined}
        />

        {/* Slot 2 or add button */}
        {second ? (
          <CyberwareSlot filled canEdit={canEdit} onRemove={() => onRemoveSlot(second.id)} />
        ) : canAdd && first ? (
          <CyberwareAddSlot onClick={onAddSlot} />
        ) : null}

        {/* Add when slot 1 is also empty */}
        {!first && canAdd ? <CyberwareAddSlot onClick={onAddSlot} /> : null}
      </div>
    </div>
  )
}
