import type { KarmaMode } from '../../types/domain'
import { clamp, cn } from '../../lib/utils'

interface SegmentedBarProps {
  value: number
  tone?: KarmaMode
  segments?: number
}

const toneMap = {
  blue: 'bg-sky-400',
  red: 'bg-rose-500',
  gray: 'bg-stone-400',
}

export function SegmentedBar({
  value,
  tone = 'gray',
  segments = 10,
}: SegmentedBarProps) {
  const activeSegments = Math.round((clamp(value) / 100) * segments)

  return (
    <div className="flex gap-1.5">
      {Array.from({ length: segments }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-2 flex-1 bg-white/7 transition-colors',
            '[clip-path:polygon(0_0,calc(100%-4px)_0,100%_100%,4px_100%)]',
            index < activeSegments && toneMap[tone],
          )}
        />
      ))}
    </div>
  )
}
