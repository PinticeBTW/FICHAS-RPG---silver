import { X } from 'lucide-react'

interface CyberwareSlotProps {
  filled: boolean
  canEdit: boolean
  onRemove?: () => void
}

export function CyberwareSlot({ filled, canEdit, onRemove }: CyberwareSlotProps) {
  return (
    <div className="group relative">
      <svg width="48" height="48" viewBox="0 0 48 48" className="block">
        {/* Outer segmented ring */}
        <circle
          cx="24"
          cy="24"
          r="20"
          fill="none"
          stroke={filled ? 'rgba(0,210,255,0.85)' : 'rgba(0,210,255,0.22)'}
          strokeWidth="2"
          strokeDasharray="10 4"
          strokeLinecap="round"
          style={{ transition: 'stroke 0.25s' }}
        />
        {/* Inner accent ring */}
        <circle
          cx="24"
          cy="24"
          r="14"
          fill="none"
          stroke={filled ? 'rgba(0,210,255,0.18)' : 'rgba(0,210,255,0.07)'}
          strokeWidth="1"
          strokeDasharray="6 5"
          strokeLinecap="round"
          style={{ transition: 'stroke 0.25s' }}
        />
        {/* Center indicator */}
        {filled ? (
          <>
            <circle cx="24" cy="24" r="5" fill="rgba(0,210,255,0.15)" />
            <circle cx="24" cy="24" r="3" fill="rgba(0,210,255,0.9)" />
          </>
        ) : (
          <circle cx="24" cy="24" r="2" fill="rgba(0,210,255,0.12)" />
        )}
        {/* Glow filter for filled state */}
        {filled && (
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke="rgba(0,210,255,0.08)"
            strokeWidth="6"
          />
        )}
      </svg>

      {filled && canEdit && onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -right-1.5 -top-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-red-500/35 bg-[#030a14] text-red-400/75 opacity-0 transition-opacity group-hover:opacity-100"
          title="Remover"
        >
          <X size={8} />
        </button>
      ) : null}
    </div>
  )
}

export function CyberwareAddSlot({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group relative" title="Adicionar slot">
      <svg width="48" height="48" viewBox="0 0 48 48" className="block">
        <circle
          cx="24"
          cy="24"
          r="20"
          fill="none"
          stroke="rgba(0,210,255,0.12)"
          strokeWidth="1.5"
          strokeDasharray="10 4"
          strokeLinecap="round"
          className="transition-all duration-200 group-hover:stroke-[rgba(0,210,255,0.45)]"
        />
        {/* + symbol */}
        <line x1="24" y1="17" x2="24" y2="31" stroke="rgba(0,210,255,0.28)" strokeWidth="1.5" strokeLinecap="round" className="transition-all duration-200 group-hover:stroke-[rgba(0,210,255,0.75)]" />
        <line x1="17" y1="24" x2="31" y2="24" stroke="rgba(0,210,255,0.28)" strokeWidth="1.5" strokeLinecap="round" className="transition-all duration-200 group-hover:stroke-[rgba(0,210,255,0.75)]" />
      </svg>
    </button>
  )
}
