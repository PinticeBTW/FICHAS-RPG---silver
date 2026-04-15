import { useMemo } from 'react'
import {
  createCyberwareSheetSlot,
  cyberwareSheetZones,
  parseCyberwareSheetSlots,
  stringifyCyberwareSheetSlots,
} from '../../lib/cyberwareSheetLayout'
import { CyberwareZone } from './CyberwareZone'
import type { CwColors } from './CyberwareSlot'

// ─── Tone colour map ──────────────────────────────────────────────────────────

export type CwTone = 'blue' | 'red' | 'grey'

const CW_COLORS: Record<CwTone, CwColors> = {
  blue: {
    accent:     '#0da7ff',
    faint:      'rgba(13,167,255,0.18)',
    dim:        'rgba(13,167,255,0.08)',
    glowFilter: 'drop-shadow(0 0 5px rgba(13,167,255,0.65))',
  },
  red: {
    accent:     '#cc1111',
    faint:      'rgba(204,17,17,0.28)',
    dim:        'rgba(204,17,17,0.10)',
    glowFilter: 'drop-shadow(0 0 5px rgba(204,17,17,0.7))',
  },
  grey: {
    accent:     '#c0c5cc',
    faint:      'rgba(192,197,204,0.28)',
    dim:        'rgba(192,197,204,0.10)',
    glowFilter: 'drop-shadow(0 0 4px rgba(192,197,204,0.55))',
  },
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CyberwareBoardProps {
  fieldData: Record<string, string>
  onFieldChange: (fieldName: string, value: string) => void
  canEdit: boolean
  tone?: CwTone
}

// ─── Meter dots ───────────────────────────────────────────────────────────────

const STEPS = 10

function MeterDots({ filled, colors }: { filled: number; colors: CwColors }) {
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
              cx="10" cy="10" r="7.7"
              fill="none"
              stroke={active ? colors.accent : colors.faint}
              strokeWidth="1.35"
              strokeDasharray="5.2 2.7"
              style={{ filter: active ? colors.glowFilter : 'none' }}
            />
            {active && (
              <circle
                cx="10" cy="10" r="2.7"
                fill={colors.accent}
                style={{ filter: colors.glowFilter }}
              />
            )}
          </svg>
        )
      })}
    </div>
  )
}

// ─── Board ────────────────────────────────────────────────────────────────────

export function CyberwareBoard({ fieldData, onFieldChange, canEdit, tone = 'blue' }: CyberwareBoardProps) {
  const colors = CW_COLORS[tone]

  const zones = useMemo(
    () =>
      cyberwareSheetZones.map((zone) => ({
        ...zone,
        slots: parseCyberwareSheetSlots(fieldData[zone.fieldKey]).slice(0, zone.maxSlots),
      })),
    [fieldData],
  )

  const leftZones  = zones.filter((zone) => zone.side === 'left')
  const rightZones = zones.filter((zone) => zone.side === 'right')
  const totalSlots = zones.reduce((sum, zone) => sum + zone.slots.length, 0)
  const cyberFilled  = Math.min(STEPS, Math.round(totalSlots * (STEPS / 14)))
  const shieldFilled = Math.min(STEPS, Math.round(totalSlots * (STEPS / 18)))

  const persist = (fieldKey: string, nextSlots: (typeof zones)[number]['slots'], maxSlots: number) => {
    onFieldChange(fieldKey, stringifyCyberwareSheetSlots(nextSlots.slice(0, maxSlots)))
  }

  const colBorder = `1px solid ${colors.faint}`
  const labelStyle: React.CSSProperties = {
    color: colors.accent,
    textShadow: `0 0 10px ${colors.faint}`,
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col" style={{ padding: '1% 3% 1%' }}>

      {/* Title */}
      <p
        className="pointer-events-none mb-3 text-center font-display uppercase"
        style={{ fontSize: '0.68rem', letterSpacing: '0.32em', ...labelStyle }}
      >
        Cyberware Matrix
      </p>

      {/* 3-column layout */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, paddingBottom: '11%' }}>

        {/* LEFT */}
        <div
          className="pointer-events-auto"
          style={{
            width: '30%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-around',
            alignItems: 'flex-end',
            paddingRight: '12px',
            borderRight: colBorder,
          }}
        >
          {leftZones.map((zone) => (
            <CyberwareZone
              key={zone.id}
              zone={zone}
              slots={zone.slots}
              canEdit={canEdit}
              colors={colors}
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

        {/* RIGHT */}
        <div
          className="pointer-events-auto"
          style={{
            width: '30%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-around',
            alignItems: 'flex-start',
            paddingLeft: '12px',
            borderLeft: colBorder,
          }}
        >
          {rightZones.map((zone) => (
            <CyberwareZone
              key={zone.id}
              zone={zone}
              slots={zone.slots}
              canEdit={canEdit}
              colors={colors}
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

      {/* CYBER / SHIELD meters */}
      <div
        className="pointer-events-none absolute"
        style={{ left: '6.8%', right: '6.8%', bottom: '3.6%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <MeterDots filled={cyberFilled} colors={colors} />
          <span className="font-display uppercase" style={{ fontSize: '0.94rem', lineHeight: 1, letterSpacing: '0.04em', ...labelStyle }}>
            CYBER
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span className="font-display uppercase" style={{ fontSize: '0.94rem', lineHeight: 1, letterSpacing: '0.04em', ...labelStyle }}>
            SHIELD
          </span>
          <MeterDots filled={shieldFilled} colors={colors} />
        </div>
      </div>
    </div>
  )
}
