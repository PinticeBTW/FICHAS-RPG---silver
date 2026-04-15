import type { CyberwareSheetSlot, CyberwareSheetZoneDefinition } from '../../lib/cyberwareSheetLayout'
import { CyberwareAddSlot, CyberwareSlot, type CwColors } from './CyberwareSlot'

interface CyberwareZoneProps {
  zone: CyberwareSheetZoneDefinition
  slots: CyberwareSheetSlot[]
  canEdit: boolean
  colors: CwColors
  onAddSlot: () => void
  onRemoveSlot: (slotId: string) => void
}

export function CyberwareZone({ zone, slots, canEdit, colors, onAddSlot, onRemoveSlot }: CyberwareZoneProps) {
  const [first, second] = slots.slice(0, zone.maxSlots)
  const canAdd = canEdit && slots.length < zone.maxSlots
  const isLeft = zone.side === 'left'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isLeft ? 'flex-end' : 'flex-start', gap: '5px' }}>
      <p
        className="font-display uppercase"
        style={{
          fontSize: '0.58rem',
          letterSpacing: '0.22em',
          color: colors.accent,
          textShadow: colors.glowFilter.replace('drop-shadow', 'drop-shadow'),
          whiteSpace: 'nowrap',
        }}
      >
        {zone.label}
      </p>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexDirection: isLeft ? 'row-reverse' : 'row' }}>
        <CyberwareSlot
          filled={Boolean(first)}
          canEdit={canEdit}
          colors={colors}
          onRemove={first ? () => onRemoveSlot(first.id) : undefined}
        />

        {second ? (
          <CyberwareSlot filled canEdit={canEdit} colors={colors} onRemove={() => onRemoveSlot(second.id)} />
        ) : canAdd && first ? (
          <CyberwareAddSlot onClick={onAddSlot} colors={colors} />
        ) : null}

        {!first && canAdd ? <CyberwareAddSlot onClick={onAddSlot} colors={colors} /> : null}
      </div>
    </div>
  )
}
