import { X } from 'lucide-react'

const C = '#0da7ff'
const C_FAINT = 'rgba(13,167,255,0.18)'
const C_MID = 'rgba(13,167,255,0.55)'

interface CyberwareSlotProps {
  filled: boolean
  canEdit: boolean
  onRemove?: () => void
}

export function CyberwareSlot({ filled, canEdit, onRemove }: CyberwareSlotProps) {
  return (
    <div className="group relative inline-flex">
      <svg width="54" height="54" viewBox="0 0 54 54">
        {/* Outer dashed ring */}
        <circle
          cx="27" cy="27" r="23"
          fill="none"
          stroke={filled ? C : C_FAINT}
          strokeWidth="1.5"
          strokeDasharray="8.5 3.5"
          strokeLinecap="butt"
          style={{ transition: 'stroke 0.2s, filter 0.2s', filter: filled ? `drop-shadow(0 0 4px ${C_MID})` : 'none' }}
        />
        {/* Inner ring */}
        <circle
          cx="27" cy="27" r="15"
          fill="none"
          stroke={filled ? 'rgba(13,167,255,0.25)' : 'rgba(13,167,255,0.07)'}
          strokeWidth="1"
          strokeDasharray="5.5 4.5"
          strokeLinecap="butt"
          style={{ transition: 'stroke 0.2s' }}
        />
        {/* Corner ticks — 4 small lines at 45° angles */}
        {[0, 90, 180, 270].map((deg) => (
          <line
            key={deg}
            x1="27" y1="4"
            x2="27" y2="9"
            stroke={filled ? C : C_FAINT}
            strokeWidth="1.5"
            strokeLinecap="round"
            transform={`rotate(${deg} 27 27)`}
            style={{ transition: 'stroke 0.2s' }}
          />
        ))}
        {/* Center */}
        {filled ? (
          <>
            <circle cx="27" cy="27" r="5" fill="rgba(13,167,255,0.12)" />
            <circle cx="27" cy="27" r="2.8" fill={C} style={{ filter: `drop-shadow(0 0 3px ${C})` }} />
          </>
        ) : (
          <circle cx="27" cy="27" r="2" fill="rgba(13,167,255,0.1)" />
        )}
      </svg>

      {filled && canEdit && onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -right-1 -top-1 flex h-[18px] w-[18px] items-center justify-center border bg-[#020c1e] opacity-0 transition-opacity group-hover:opacity-100"
          style={{ borderColor: 'rgba(255,60,60,0.4)', color: 'rgba(255,80,80,0.8)' }}
          title="Remover"
        >
          <X size={9} />
        </button>
      ) : null}
    </div>
  )
}

export function CyberwareAddSlot({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group relative inline-flex" title="Adicionar">
      <svg width="54" height="54" viewBox="0 0 54 54">
        <circle
          cx="27" cy="27" r="23"
          fill="none"
          stroke="rgba(13,167,255,0.12)"
          strokeWidth="1.5"
          strokeDasharray="8.5 3.5"
          className="transition-all duration-200 group-hover:stroke-[rgba(13,167,255,0.5)]"
        />
        <circle
          cx="27" cy="27" r="15"
          fill="none"
          stroke="rgba(13,167,255,0.05)"
          strokeWidth="1"
          strokeDasharray="5.5 4.5"
          className="transition-all duration-200 group-hover:stroke-[rgba(13,167,255,0.18)]"
        />
        {/* + symbol */}
        <line x1="27" y1="20" x2="27" y2="34" stroke="rgba(13,167,255,0.3)" strokeWidth="1.5" strokeLinecap="round" className="transition-all duration-200 group-hover:stroke-[rgba(13,167,255,0.75)]" />
        <line x1="20" y1="27" x2="34" y2="27" stroke="rgba(13,167,255,0.3)" strokeWidth="1.5" strokeLinecap="round" className="transition-all duration-200 group-hover:stroke-[rgba(13,167,255,0.75)]" />
      </svg>
    </button>
  )
}
