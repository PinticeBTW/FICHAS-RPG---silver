import { X } from 'lucide-react'

const C = '#0da7ff'
const C_FAINT = 'rgba(13,167,255,0.2)'
const GLOW = 'drop-shadow(0 0 5px rgba(13,167,255,0.65))'

interface CyberwareSlotProps {
  filled: boolean
  canEdit: boolean
  onRemove?: () => void
}

export function CyberwareSlot({ filled, canEdit, onRemove }: CyberwareSlotProps) {
  return (
    <div className="group relative inline-flex">
      <svg width="68" height="68" viewBox="0 0 68 68">
        <circle
          cx="34"
          cy="34"
          r="30"
          fill="none"
          stroke={filled ? C : C_FAINT}
          strokeWidth="1.8"
          strokeDasharray="11 4"
          strokeLinecap="butt"
          style={{ transition: 'stroke 0.2s', filter: filled ? GLOW : 'none' }}
        />
        <circle
          cx="34"
          cy="34"
          r="21"
          fill={filled ? 'rgba(13,167,255,0.04)' : 'none'}
          stroke={filled ? 'rgba(13,167,255,0.28)' : 'rgba(13,167,255,0.07)'}
          strokeWidth="1"
          strokeDasharray="7 5"
          style={{ transition: 'all 0.2s' }}
        />
        {[0, 90, 180, 270].map((deg) => (
          <line
            key={deg}
            x1="34"
            y1="2"
            x2="34"
            y2="9"
            stroke={filled ? C : C_FAINT}
            strokeWidth="2"
            strokeLinecap="round"
            transform={`rotate(${deg} 34 34)`}
            style={{ transition: 'stroke 0.2s', filter: filled ? GLOW : 'none' }}
          />
        ))}
        {filled ? (
          <>
            <circle cx="34" cy="34" r="9" fill="rgba(13,167,255,0.1)" />
            <circle cx="34" cy="34" r="4.5" fill={C} style={{ filter: GLOW }} />
          </>
        ) : (
          <circle cx="34" cy="34" r="3" fill="rgba(13,167,255,0.08)" />
        )}
      </svg>

      {filled && canEdit && onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center border bg-[#020c1e] opacity-0 transition-opacity group-hover:opacity-100"
          style={{ borderColor: 'rgba(255,60,60,0.45)', color: 'rgba(255,80,80,0.85)' }}
          title="Remover"
        >
          <X size={10} />
        </button>
      ) : null}
    </div>
  )
}

export function CyberwareAddSlot({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group inline-flex" title="Adicionar slot">
      <svg width="68" height="68" viewBox="0 0 68 68">
        <circle
          cx="34"
          cy="34"
          r="30"
          fill="none"
          stroke="rgba(13,167,255,0.1)"
          strokeWidth="1.8"
          strokeDasharray="11 4"
          className="transition-all duration-200 group-hover:stroke-[rgba(13,167,255,0.5)]"
          style={{ transition: 'stroke 0.2s' }}
        />
        <circle
          cx="34"
          cy="34"
          r="21"
          fill="none"
          stroke="rgba(13,167,255,0.04)"
          strokeWidth="1"
          strokeDasharray="7 5"
          style={{ transition: 'stroke 0.2s' }}
          className="group-hover:stroke-[rgba(13,167,255,0.18)]"
        />
        <line
          x1="34"
          y1="23"
          x2="34"
          y2="45"
          stroke="rgba(13,167,255,0.25)"
          strokeWidth="2"
          strokeLinecap="round"
          style={{ transition: 'stroke 0.2s' }}
          className="group-hover:stroke-[rgba(13,167,255,0.75)]"
        />
        <line
          x1="23"
          y1="34"
          x2="45"
          y2="34"
          stroke="rgba(13,167,255,0.25)"
          strokeWidth="2"
          strokeLinecap="round"
          style={{ transition: 'stroke 0.2s' }}
          className="group-hover:stroke-[rgba(13,167,255,0.75)]"
        />
      </svg>
    </button>
  )
}
