import { LoaderCircle, RefreshCw } from 'lucide-react'

interface NvnReaderFeedbackProps {
  title: string
  detail: string
  loading?: boolean
  error?: boolean
  onRetry?: () => void
}

export function NvnReaderFeedback({
  title,
  detail,
  loading = false,
  error = false,
  onRetry,
}: NvnReaderFeedbackProps) {
  return (
    <section
      className="nvn-reader-feedback"
      data-error={error ? 'true' : 'false'}
      role={error ? 'alert' : 'status'}
      aria-live="polite"
      aria-busy={loading ? 'true' : undefined}
    >
      {loading ? <LoaderCircle className="nvn-reader-feedback__spinner" size={20} aria-hidden="true" /> : null}
      <h2>{title}</h2>
      <p>{detail}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          <RefreshCw size={13} aria-hidden="true" />
          Retry
        </button>
      ) : null}
    </section>
  )
}

interface NvnRefreshStripProps {
  message: string
  error?: boolean
  onRetry?: () => void
}

export function NvnRefreshStrip({ message, error = false, onRetry }: NvnRefreshStripProps) {
  return (
    <div className="nvn-refresh-strip" data-error={error ? 'true' : 'false'} role="status">
      <span>{message}</span>
      {onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}
    </div>
  )
}
