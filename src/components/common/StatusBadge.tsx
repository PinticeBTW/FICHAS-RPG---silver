import type { KarmaMode } from '../../types/domain'
import { cn, getToneClasses } from '../../lib/utils'

interface StatusBadgeProps {
  label: string
  tone?: KarmaMode
  className?: string
}

export function StatusBadge({
  label,
  tone = 'gray',
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em]',
        '[clip-path:polygon(0_0,calc(100%-10px)_0,100%_10px,100%_100%,10px_100%,0_calc(100%-10px))]',
        getToneClasses(tone),
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}
