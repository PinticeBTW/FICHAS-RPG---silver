import type { Cyberware } from '../../types/cyberware'
import { CyberwareIcon } from './CyberwareIcon'

export interface CwColors {
  accent: string
  faint: string
  dim: string
  glowFilter: string
}

interface CyberwareSlotProps {
  cyberware: Cyberware | null
  selected: boolean
  canEdit: boolean
  colors: CwColors
  onClick?: () => void
}

export function CyberwareSlot({ cyberware, selected, canEdit, colors, onClick }: CyberwareSlotProps) {
  const isInteractive = canEdit && Boolean(onClick)
  const filled = Boolean(cyberware)

  return (
    <div className="group relative inline-flex h-full w-full items-center justify-center">
      <button
        type="button"
        onClick={onClick}
        disabled={!isInteractive}
        className="absolute inset-0 flex items-center justify-center bg-transparent disabled:cursor-default"
        title={filled ? 'Ver cyberware' : 'Equipar cyberware'}
      >
        <span
          className="pointer-events-none absolute inset-[10%] rounded-full transition-all duration-150"
          style={{
            background: selected ? colors.dim : 'transparent',
            boxShadow: selected ? `0 0 14px ${colors.faint}` : 'none',
            border: selected ? `1px solid ${colors.accent}` : '1px solid transparent',
          }}
        />

        {!filled ? (
          <span
            className="pointer-events-none font-display leading-none transition-transform duration-150 group-hover:scale-110"
            style={{
              color: colors.accent,
              fontSize: 'calc(22px * var(--sheet-scale, 1))',
              textShadow: `0 0 8px ${colors.faint}`,
            }}
          >
            +
          </span>
        ) : (
          cyberware ? (
            <CyberwareIcon
              cyberware={cyberware}
              alt={cyberware.name}
              accentColor={colors.accent}
              glowFilter={colors.glowFilter}
              className="pointer-events-none absolute h-[56%] w-[56%] object-contain"
              fallbackClassName="pointer-events-none absolute flex h-[56%] w-[56%] items-center justify-center font-display text-[calc(12px_*_var(--sheet-scale,1))] leading-none"
            />
          ) : null
        )}
      </button>
    </div>
  )
}
