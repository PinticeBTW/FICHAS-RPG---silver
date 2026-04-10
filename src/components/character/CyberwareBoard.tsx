import { useMemo } from 'react'
import {
  createCyberwareSheetSlot,
  cyberwareSheetZones,
  parseCyberwareSheetSlots,
  stringifyCyberwareSheetSlots,
} from '../../lib/cyberwareSheetLayout'
import { CyberwareZone } from './CyberwareZone'

interface CyberwareBoardProps {
  fieldData: Record<string, string>
  onFieldChange: (fieldName: string, value: string) => void
  canEdit: boolean
}

const STEPS = 16

function MeterRow({ label, filled }: { label: string; filled: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span
        className="font-display uppercase text-[#0da7ff]"
        style={{
          fontSize: '0.6rem',
          letterSpacing: '0.22em',
          textShadow: '0 0 6px rgba(13,167,255,0.55)',
          minWidth: '3.8rem',
        }}
      >
        {label}
      </span>

      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        {Array.from({ length: STEPS }, (_, i) => {
          const active = i < filled
          return (
            <svg key={i} width="18" height="18" viewBox="0 0 18 18">
              <circle
                cx="9" cy="9" r="7"
                fill="none"
                stroke={active ? '#0da7ff' : 'rgba(13,167,255,0.16)'}
                strokeWidth="1.2"
                strokeDasharray="5 2.8"
                strokeLinecap="butt"
                style={{ filter: active ? 'drop-shadow(0 0 2px rgba(13,167,255,0.6))' : 'none' }}
              />
              {active && <circle cx="9" cy="9" r="2.2" fill="rgba(13,167,255,0.85)" />}
            </svg>
          )
        })}
      </div>
    </div>
  )
}

export function CyberwareBoard({ fieldData, onFieldChange, canEdit }: CyberwareBoardProps) {
  const zones = useMemo(
    () =>
      cyberwareSheetZones.map((zone) => ({
        ...zone,
        slots: parseCyberwareSheetSlots(fieldData[zone.fieldKey]).slice(0, zone.maxSlots),
      })),
    [fieldData],
  )

  const totalSlots = zones.reduce((sum, z) => sum + z.slots.length, 0)
  const cyberFilled = Math.min(STEPS, Math.round(totalSlots * (STEPS / 14)))
  const shieldFilled = Math.min(STEPS, Math.round(totalSlots * (STEPS / 18)))

  const persistZone = (fieldKey: string, nextSlots: (typeof zones)[number]['slots']) => {
    const zone = zones.find((z) => z.fieldKey === fieldKey)
    const limited = zone ? nextSlots.slice(0, zone.maxSlots) : nextSlots
    onFieldChange(fieldKey, stringifyCyberwareSheetSlots(limited))
  }

  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: '3.8%', top: '8.1%', width: '92.4%', height: '79.2%' }}
    >
      {/* Page title */}
      <p
        className="pointer-events-none absolute font-display uppercase text-[#0da7ff]"
        style={{
          left: '50%',
          top: '1.5%',
          transform: 'translateX(-50%)',
          fontSize: '0.62rem',
          letterSpacing: '0.28em',
          whiteSpace: 'nowrap',
          textShadow: '0 0 10px rgba(13,167,255,0.6)',
        }}
      >
        Cyberware Matrix
      </p>

      {/* Zones */}
      {zones.map((zone) => (
        <CyberwareZone
          key={zone.id}
          zone={zone}
          slots={zone.slots}
          canEdit={canEdit}
          onAddSlot={() => {
            if (zone.slots.length >= zone.maxSlots) return
            persistZone(zone.fieldKey, [...zone.slots, createCyberwareSheetSlot()])
          }}
          onRemoveSlot={(id) =>
            persistZone(zone.fieldKey, zone.slots.filter((s) => s.id !== id))
          }
        />
      ))}

      {/* CYBER / SHIELD bars */}
      <div
        className="pointer-events-none absolute"
        style={{ left: '3%', bottom: '3%', display: 'flex', flexDirection: 'column', gap: '8px' }}
      >
        <MeterRow label="CYBER" filled={cyberFilled} />
        <MeterRow label="SHIELD" filled={shieldFilled} />
      </div>

      {/* Edit hint */}
      {canEdit ? (
        <p
          className="pointer-events-none absolute font-display uppercase"
          style={{
            left: '50%',
            bottom: '19%',
            transform: 'translateX(-50%)',
            fontSize: '0.38rem',
            letterSpacing: '0.16em',
            whiteSpace: 'nowrap',
            color: 'rgba(13,167,255,0.2)',
          }}
        >
          clica + para adicionar · hover para remover
        </p>
      ) : null}
    </div>
  )
}
