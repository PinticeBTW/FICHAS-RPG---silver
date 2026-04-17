import type { CSSProperties } from 'react'
import {
  CYBERWARE_DEFAULT_METER_MAX,
  cyberwareSheetMeterLimits,
  cyberwareSheetMeters,
} from '../../lib/cyberwareSheetLayout'
import type { CyberwareTotals as CyberwareTotalsValue } from '../../types/cyberware'
import type { CwColors } from './CyberwareSlot'

interface CyberwareTotalsProps {
  totals: CyberwareTotalsValue
  colors: CwColors
  canEdit: boolean
  cyberMaxValue: string
  shieldMaxValue: string
  onCyberMaxChange: (value: string) => void
  onShieldMaxChange: (value: string) => void
}

type MeterFillState = 'empty' | 'half' | 'full'

function resolveMeterMaxValue(rawValue: string): number {
  const parsed = Number(rawValue.replace(/[^\d.,-]/g, '').replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : CYBERWARE_DEFAULT_METER_MAX
}

function getMeterFillStates(total: number, maxValue: number, orbCount: number): MeterFillState[] {
  const cappedUnits = Math.max(
    0,
    Math.min(orbCount, Math.round(((total / maxValue) * orbCount) * 2) / 2),
  )

  return Array.from({ length: orbCount }, (_, index) => {
    const remaining = cappedUnits - index

    if (remaining >= 1) {
      return 'full'
    }

    if (remaining >= 0.5) {
      return 'half'
    }

    return 'empty'
  })
}

function buildAbsoluteBoxStyle(box: { left: number; top: number; width: number; height: number }): CSSProperties {
  return {
    position: 'absolute',
    left: `${box.left}%`,
    top: `${box.top}%`,
    width: `${box.width}%`,
    height: `${box.height}%`,
  }
}

function MeterOrb({
  fillState,
  colors,
  box,
}: {
  fillState: MeterFillState
  colors: CwColors
  box: { left: number; top: number; width: number; height: number }
}) {
  if (fillState === 'empty') {
    return null
  }

  const fillBackground =
    fillState === 'full'
      ? colors.accent
      : `linear-gradient(90deg, ${colors.accent} 0 50%, transparent 50% 100%)`

  return (
    <div style={{ ...buildAbsoluteBoxStyle(box), pointerEvents: 'none' }}>
      <span
        className="absolute rounded-full"
        style={{
          inset: '17%',
          background: fillBackground,
          boxShadow: `0 0 7px ${colors.accent}`,
          filter: colors.glowFilter,
          opacity: 0.96,
        }}
      />
    </div>
  )
}

function MeterLimitInput({
  value,
  canEdit,
  colors,
  box,
  onChange,
}: {
  value: string
  canEdit: boolean
  colors: CwColors
  box: { left: number; top: number; width: number; height: number }
  onChange: (value: string) => void
}) {
  return (
    <div className="pointer-events-auto absolute" style={buildAbsoluteBoxStyle(box)}>
      <input
        value={value}
        readOnly={!canEdit}
        inputMode="numeric"
        placeholder={String(CYBERWARE_DEFAULT_METER_MAX)}
        onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, ''))}
        className="h-full w-full border-none bg-transparent text-center font-display text-[#f8f8f4] outline-none"
        style={{
          fontSize: 'calc(11px * var(--sheet-scale, 1))',
          lineHeight: 1,
          letterSpacing: '0.08em',
          textShadow: `0 0 8px ${colors.faint}`,
        }}
      />
    </div>
  )
}

export function CyberwareTotals({
  totals,
  colors,
  canEdit,
  cyberMaxValue,
  shieldMaxValue,
  onCyberMaxChange,
  onShieldMaxChange,
}: CyberwareTotalsProps) {
  const cyberMax = resolveMeterMaxValue(cyberMaxValue)
  const shieldMax = resolveMeterMaxValue(shieldMaxValue)
  const cyberFillStates = getMeterFillStates(totals.cyberTotal, cyberMax, cyberwareSheetMeters.cyber.length)
  const shieldFillStates = getMeterFillStates(totals.shieldTotal, shieldMax, cyberwareSheetMeters.shield.length)

  return (
    <>
      {cyberwareSheetMeters.cyber.map((box, index) => (
        <MeterOrb
          key={`cyber-${index}`}
          fillState={cyberFillStates[index]}
          colors={colors}
          box={box}
        />
      ))}

      {cyberwareSheetMeters.shield.map((box, index) => (
        <MeterOrb
          key={`shield-${index}`}
          fillState={shieldFillStates[index]}
          colors={colors}
          box={box}
        />
      ))}

      <MeterLimitInput
        value={cyberMaxValue}
        canEdit={canEdit}
        colors={colors}
        box={cyberwareSheetMeterLimits.cyber}
        onChange={onCyberMaxChange}
      />

      <MeterLimitInput
        value={shieldMaxValue}
        canEdit={canEdit}
        colors={colors}
        box={cyberwareSheetMeterLimits.shield}
        onChange={onShieldMaxChange}
      />
    </>
  )
}
