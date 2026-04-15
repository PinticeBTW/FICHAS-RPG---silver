import { useState } from 'react'
import { X } from 'lucide-react'

export interface CwColors {
  accent: string
  faint: string
  dim: string
  glowFilter: string
}

interface CyberwareSlotProps {
  filled: boolean
  canEdit: boolean
  colors: CwColors
  onRemove?: () => void
}

export function CyberwareSlot({ filled, canEdit, colors, onRemove }: CyberwareSlotProps) {
  const { accent, faint, dim, glowFilter } = colors
  return (
    <div className="group relative inline-flex">
      <svg width="68" height="68" viewBox="0 0 68 68">
        {/* Outer dashed ring */}
        <circle
          cx="34" cy="34" r="30"
          fill="none"
          stroke={filled ? accent : faint}
          strokeWidth="1.8"
          strokeDasharray="11 4"
          strokeLinecap="butt"
          style={{ transition: 'stroke 0.2s', filter: filled ? glowFilter : 'none' }}
        />
        {/* Inner dashed ring */}
        <circle
          cx="34" cy="34" r="21"
          fill={filled ? dim : 'none'}
          stroke={filled ? faint : dim}
          strokeWidth="1"
          strokeDasharray="7 5"
          style={{ transition: 'all 0.2s' }}
        />
        {/* Cardinal tick marks */}
        {[0, 90, 180, 270].map((deg) => (
          <line
            key={deg}
            x1="34" y1="2" x2="34" y2="9"
            stroke={filled ? accent : faint}
            strokeWidth="2"
            strokeLinecap="round"
            transform={`rotate(${deg} 34 34)`}
            style={{ transition: 'stroke 0.2s', filter: filled ? glowFilter : 'none' }}
          />
        ))}
        {/* Center dot */}
        {filled ? (
          <>
            <circle cx="34" cy="34" r="9" fill={dim} />
            <circle cx="34" cy="34" r="4.5" fill={accent} style={{ filter: glowFilter }} />
          </>
        ) : (
          <circle cx="34" cy="34" r="3" fill={dim} />
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

export function CyberwareAddSlot({ onClick, colors }: { onClick: () => void; colors: CwColors }) {
  const [hovered, setHovered] = useState(false)
  const { accent, faint, dim } = colors
  const ringStroke    = hovered ? faint   : dim
  const innerStroke   = hovered ? dim     : `${dim}`
  const crossStroke   = hovered ? accent  : faint

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="inline-flex"
      title="Adicionar slot"
    >
      <svg width="68" height="68" viewBox="0 0 68 68">
        <circle
          cx="34" cy="34" r="30"
          fill="none"
          stroke={ringStroke}
          strokeWidth="1.8"
          strokeDasharray="11 4"
          style={{ transition: 'stroke 0.2s' }}
        />
        <circle
          cx="34" cy="34" r="21"
          fill="none"
          stroke={innerStroke}
          strokeWidth="1"
          strokeDasharray="7 5"
          style={{ transition: 'stroke 0.2s' }}
        />
        <line x1="34" y1="23" x2="34" y2="45"
          stroke={crossStroke} strokeWidth="2" strokeLinecap="round"
          style={{ transition: 'stroke 0.2s' }}
        />
        <line x1="23" y1="34" x2="45" y2="34"
          stroke={crossStroke} strokeWidth="2" strokeLinecap="round"
          style={{ transition: 'stroke 0.2s' }}
        />
      </svg>
    </button>
  )
}
