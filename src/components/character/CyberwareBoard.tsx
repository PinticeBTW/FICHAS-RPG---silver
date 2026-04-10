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

const METER_STEPS = 14

function MeterRow({ label, filled }: { label: string; filled: number }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="w-14 font-display text-[0.65rem] uppercase tracking-[0.18em] text-[#0dd4ff]"
        style={{ textShadow: '0 0 8px rgba(0,210,255,0.5)' }}
      >
        {label}
      </span>
      <div className="flex items-center gap-[3px]">
        {Array.from({ length: METER_STEPS }, (_, i) => {
          const active = i < filled
          return (
            <svg key={i} width="16" height="16" viewBox="0 0 16 16">
              <circle
                cx="8"
                cy="8"
                r="6"
                fill="none"
                stroke={active ? 'rgba(0,210,255,0.85)' : 'rgba(0,210,255,0.18)'}
                strokeWidth="1.5"
                strokeDasharray="5 3"
                strokeLinecap="round"
              />
              {active && <circle cx="8" cy="8" r="2" fill="rgba(0,210,255,0.75)" />}
            </svg>
          )
        })}
      </div>
    </div>
  )
}

export function CyberwareBoard({
  fieldData,
  onFieldChange,
  canEdit,
}: CyberwareBoardProps) {
  const zones = useMemo(
    () =>
      cyberwareSheetZones.map((zone) => ({
        ...zone,
        slots: parseCyberwareSheetSlots(fieldData[zone.fieldKey]).slice(0, zone.maxSlots),
      })),
    [fieldData],
  )

  const totalSlots = zones.reduce((sum, zone) => sum + zone.slots.length, 0)
  const cyberFilled = Math.min(METER_STEPS, Math.round(totalSlots * (METER_STEPS / 16)))
  const shieldFilled = Math.min(METER_STEPS, Math.round(totalSlots * (METER_STEPS / 20)))

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
      {/* Title */}
      <p
        className="pointer-events-none absolute font-display uppercase text-[#0dd4ff]"
        style={{
          left: '50%',
          top: '2.5%',
          transform: 'translateX(-50%)',
          fontSize: '0.65rem',
          letterSpacing: '0.22em',
          whiteSpace: 'nowrap',
          textShadow: '0 0 10px rgba(0,210,255,0.55)',
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
          onRemoveSlot={(slotId) =>
            persistZone(
              zone.fieldKey,
              zone.slots.filter((s) => s.id !== slotId),
            )
          }
        />
      ))}

      {/* CYBER / SHIELD meters */}
      <div
        className="pointer-events-none absolute space-y-2"
        style={{ left: '4%', bottom: '5%' }}
      >
        <MeterRow label="CYBER" filled={cyberFilled} />
        <MeterRow label="SHIELD" filled={shieldFilled} />
      </div>

      {/* Hint */}
      {canEdit ? (
        <p
          className="pointer-events-none absolute font-display uppercase text-[#0dd4ff]/20"
          style={{
            left: '50%',
            bottom: '18%',
            transform: 'translateX(-50%)',
            fontSize: '0.42rem',
            letterSpacing: '0.14em',
            whiteSpace: 'nowrap',
          }}
        >
          Clica + para adicionar · hover para remover
        </p>
      ) : null}
    </div>
  )
}
