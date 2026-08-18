import type { KarmaMode } from '../../types/domain'
import { cn } from '../../lib/utils'
import { SegmentedBar } from './SegmentedBar'

interface MetricCardProps {
  label: string
  value: string
  detail?: string
  progress?: number
  tone?: KarmaMode
  className?: string
}

const accentMap = {
  blue: 'bg-sky-400',
  red: 'bg-rose-500',
  gray: 'bg-[#f3e600]',
}

export function MetricCard({
  label,
  value,
  detail,
  progress,
  tone = 'gray',
  className,
}: MetricCardProps) {
  return (
    <article className={cn('hud-panel rounded-[22px] p-4', className)}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="panel-title">{label}</p>
          <p className="mt-2 text-[2.4rem] leading-none text-white">{value}</p>
        </div>
        <span className={cn('mt-1 h-2.5 w-10', accentMap[tone])} />
      </div>

      {detail ? <p className="text-sm leading-6 text-stone-300">{detail}</p> : null}

      {typeof progress === 'number' ? (
        <div className="mt-4">
          <SegmentedBar value={progress} tone={tone} />
        </div>
      ) : null}
    </article>
  )
}
