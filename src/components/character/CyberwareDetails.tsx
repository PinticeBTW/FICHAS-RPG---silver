import type { Cyberware } from '../../types/cyberware'
import type { CwColors } from './CyberwareSlot'
import { CyberwareIcon } from './CyberwareIcon'

interface CyberwareDetailsProps {
  title: string
  cyberware: Cyberware | null
  colors: CwColors
  emptyLabel?: string
}

export function CyberwareDetails({
  title,
  cyberware,
  colors,
  emptyLabel = 'Nenhuma cyberware equipada neste slot.',
}: CyberwareDetailsProps) {
  return (
    <div
      className="rounded-sm border bg-[#03031c]/95 p-4"
      style={{ borderColor: colors.faint, boxShadow: `0 0 18px ${colors.dim}` }}
    >
      <p
        className="font-display uppercase"
        style={{ color: colors.accent, fontSize: '0.82rem', letterSpacing: '0.18em' }}
      >
        {title}
      </p>

      {cyberware ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-[1.16rem] uppercase leading-[1.05] tracking-[0.08em] text-[#f8f8f4]">
                {cyberware.name}
              </p>
              <p className="mt-1 text-[0.78rem] uppercase tracking-[0.16em]" style={{ color: colors.accent }}>
                {cyberware.slotType}
              </p>
            </div>

            <div
              className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-sm border"
              style={{ borderColor: colors.faint, color: colors.accent }}
            >
              <CyberwareIcon
                cyberware={cyberware}
                alt={cyberware.name}
                accentColor={colors.accent}
                glowFilter={colors.glowFilter}
                className="h-[76%] w-[76%] object-contain"
                fallbackClassName="flex h-full w-full items-center justify-center font-display text-[0.86rem] uppercase"
              />
            </div>
          </div>

          <p className="text-[0.96rem] leading-[1.45] text-[#d5d7df]">{cyberware.description}</p>

          <div className="flex flex-wrap gap-2 text-[0.82rem] font-semibold uppercase tracking-[0.12em]">
            <span
              className="rounded-sm border px-3 py-1.5"
              style={{ borderColor: colors.faint, color: colors.accent }}
            >
              Cyber {cyberware.cyberCost}
            </span>
            <span
              className="rounded-sm border px-3 py-1.5"
              style={{ borderColor: colors.faint, color: colors.accent }}
            >
              Shield {cyberware.shieldValue}
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[0.96rem] leading-[1.45] text-[#aeb6c6]">{emptyLabel}</p>
      )}
    </div>
  )
}
