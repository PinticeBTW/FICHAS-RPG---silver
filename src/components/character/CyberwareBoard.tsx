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
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
      <span
        className="font-display uppercase text-[#0da7ff]"
        style={{ fontSize: '0.85rem', letterSpacing: '0.28em', textShadow: '0 0 10px rgba(13,167,255,0.7)', minWidth: '5.5rem' }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', gap: '6px' }}>
        {Array.from({ length: STEPS }, (_, i) => {
          const active = i < filled
          return (
            <svg key={i} width="28" height="28" viewBox="0 0 28 28">
              <circle cx="14" cy="14" r="11" fill="none"
                stroke={active ? '#0da7ff' : 'rgba(13,167,255,0.18)'}
                strokeWidth="1.6" strokeDasharray="7 3.5"
                style={{ filter: active ? 'drop-shadow(0 0 4px rgba(13,167,255,0.75))' : 'none' }}
              />
              {active && <circle cx="14" cy="14" r="3.8" fill="rgba(13,167,255,0.9)" style={{ filter: 'drop-shadow(0 0 3px rgba(13,167,255,0.8))' }} />}
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

  const leftZones  = zones.filter((z) => z.side === 'left')
  const rightZones = zones.filter((z) => z.side === 'right')
  const totalSlots = zones.reduce((sum, z) => sum + z.slots.length, 0)
  const cyberFilled  = Math.min(STEPS, Math.round(totalSlots * (STEPS / 14)))
  const shieldFilled = Math.min(STEPS, Math.round(totalSlots * (STEPS / 18)))

  const persist = (fieldKey: string, nextSlots: (typeof zones)[number]['slots'], maxSlots: number) => {
    onFieldChange(fieldKey, stringifyCyberwareSheetSlots(nextSlots.slice(0, maxSlots)))
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col" style={{ padding: '5% 3% 4%' }}>

      {/* Title */}
      <p
        className="pointer-events-none mb-3 text-center font-display uppercase text-[#0da7ff]"
        style={{ fontSize: '0.68rem', letterSpacing: '0.32em', textShadow: '0 0 12px rgba(13,167,255,0.65)' }}
      >
        Cyberware Matrix
      </p>

      {/* Main 3-column layout */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* LEFT column */}
        <div
          className="pointer-events-auto"
          style={{
            width: '30%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-around',
            alignItems: 'flex-end',
            paddingRight: '12px',
            borderRight: '1px solid rgba(13,167,255,0.12)',
          }}
        >
          {leftZones.map((zone) => (
            <CyberwareZone
              key={zone.id}
              zone={zone}
              slots={zone.slots}
              canEdit={canEdit}
              onAddSlot={() => {
                if (zone.slots.length >= zone.maxSlots) return
                persist(zone.fieldKey, [...zone.slots, createCyberwareSheetSlot()], zone.maxSlots)
              }}
              onRemoveSlot={(id) =>
                persist(zone.fieldKey, zone.slots.filter((s) => s.id !== id), zone.maxSlots)
              }
            />
          ))}
        </div>

        {/* CENTER — body visible here, nothing overlapping */}
        <div style={{ flex: 1 }} />

        {/* RIGHT column */}
        <div
          className="pointer-events-auto"
          style={{
            width: '30%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-around',
            alignItems: 'flex-start',
            paddingLeft: '12px',
            borderLeft: '1px solid rgba(13,167,255,0.12)',
          }}
        >
          {rightZones.map((zone) => (
            <CyberwareZone
              key={zone.id}
              zone={zone}
              slots={zone.slots}
              canEdit={canEdit}
              onAddSlot={() => {
                if (zone.slots.length >= zone.maxSlots) return
                persist(zone.fieldKey, [...zone.slots, createCyberwareSheetSlot()], zone.maxSlots)
              }}
              onRemoveSlot={(id) =>
                persist(zone.fieldKey, zone.slots.filter((s) => s.id !== id), zone.maxSlots)
              }
            />
          ))}
        </div>
      </div>

      {/* CYBER / SHIELD meters */}
      <div
        className="pointer-events-none mt-4 flex flex-col gap-2"
        style={{ borderTop: '1px solid rgba(13,167,255,0.1)', paddingTop: '10px' }}
      >
        <MeterRow label="CYBER"  filled={cyberFilled} />
        <MeterRow label="SHIELD" filled={shieldFilled} />
      </div>

    </div>
  )
}
