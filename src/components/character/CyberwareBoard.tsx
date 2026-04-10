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

const STEPS = 10

function MeterDots({ filled }: { filled: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 20px)',
        gridTemplateRows: 'repeat(2, 20px)',
        gap: '4px',
      }}
    >
      {Array.from({ length: STEPS }, (_, i) => {
        const active = i < filled

        return (
          <svg key={i} width="20" height="20" viewBox="0 0 20 20">
            <circle
              cx="10"
              cy="10"
              r="7.7"
              fill="none"
              stroke={active ? '#0da7ff' : 'rgba(13,167,255,0.18)'}
              strokeWidth="1.35"
              strokeDasharray="5.2 2.7"
              style={{ filter: active ? 'drop-shadow(0 0 3px rgba(13,167,255,0.75))' : 'none' }}
            />
            {active ? (
              <circle
                cx="10"
                cy="10"
                r="2.7"
                fill="rgba(13,167,255,0.9)"
                style={{ filter: 'drop-shadow(0 0 3px rgba(13,167,255,0.8))' }}
              />
            ) : null}
          </svg>
        )
      })}
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

  const leftZones = zones.filter((zone) => zone.side === 'left')
  const rightZones = zones.filter((zone) => zone.side === 'right')
  const totalSlots = zones.reduce((sum, zone) => sum + zone.slots.length, 0)
  const cyberFilled = Math.min(STEPS, Math.round(totalSlots * (STEPS / 14)))
  const shieldFilled = Math.min(STEPS, Math.round(totalSlots * (STEPS / 18)))

  const persist = (fieldKey: string, nextSlots: (typeof zones)[number]['slots'], maxSlots: number) => {
    onFieldChange(fieldKey, stringifyCyberwareSheetSlots(nextSlots.slice(0, maxSlots)))
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col" style={{ padding: '1% 3% 1%' }}>
      <p
        className="pointer-events-none mb-3 text-center font-display uppercase text-[#0da7ff]"
        style={{ fontSize: '0.68rem', letterSpacing: '0.32em', textShadow: '0 0 12px rgba(13,167,255,0.65)' }}
      >
        Cyberware Matrix
      </p>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, paddingBottom: '11%' }}>
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
                persist(zone.fieldKey, zone.slots.filter((slot) => slot.id !== id), zone.maxSlots)
              }
            />
          ))}
        </div>

        <div style={{ flex: 1 }} />

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
                persist(zone.fieldKey, zone.slots.filter((slot) => slot.id !== id), zone.maxSlots)
              }
            />
          ))}
        </div>
      </div>

      <div
        className="pointer-events-none absolute"
        style={{
          left: '6.8%',
          right: '6.8%',
          bottom: '3.6%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <MeterDots filled={cyberFilled} />
          <span
            className="font-display uppercase text-[#0da7ff]"
            style={{
              fontSize: '0.94rem',
              lineHeight: 1,
              letterSpacing: '0.04em',
              textShadow: '0 0 10px rgba(13,167,255,0.7)',
            }}
          >
            CYBER
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span
            className="font-display uppercase text-[#0da7ff]"
            style={{
              fontSize: '0.94rem',
              lineHeight: 1,
              letterSpacing: '0.04em',
              textShadow: '0 0 10px rgba(13,167,255,0.7)',
            }}
          >
            SHIELD
          </span>
          <MeterDots filled={shieldFilled} />
        </div>
      </div>
    </div>
  )
}
