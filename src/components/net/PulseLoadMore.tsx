import { ChevronDown, RefreshCw } from 'lucide-react'

interface PulseLoadMoreProps {
  readonly available: boolean
  readonly pending: boolean
  readonly failed?: boolean
  readonly label?: string
  readonly onLoad: () => void
}

export function PulseLoadMore({
  available,
  pending,
  failed = false,
  label = 'Load more',
  onLoad,
}: PulseLoadMoreProps) {
  if (!available && !pending && !failed) return null
  return (
    <div className="pulse-load-more" role="status" aria-live="polite">
      <button type="button" disabled={pending} onClick={onLoad}>
        {failed ? <RefreshCw size={14} /> : <ChevronDown size={14} />}
        {pending ? 'SYNCING…' : failed ? 'RETRY PAGE' : label}
      </button>
    </div>
  )
}
