import { LoaderCircle, RefreshCw } from 'lucide-react'

function classes(prefix: string, token: string) {
  return `${prefix}-${token}`
}

export function NewsPlatformFeedback({
  classNamePrefix,
  title,
  detail,
  loading = false,
  error = false,
  onRetry,
}: {
  readonly classNamePrefix: string
  readonly title: string
  readonly detail: string
  readonly loading?: boolean
  readonly error?: boolean
  readonly onRetry?: () => void
}) {
  return (
    <section
      className={classes(classNamePrefix, 'reader-feedback')}
      data-error={error ? 'true' : 'false'}
      role={error ? 'alert' : 'status'}
      aria-live="polite"
      aria-busy={loading ? 'true' : undefined}
    >
      {loading ? <LoaderCircle className={classes(classNamePrefix, 'reader-feedback__spinner')} size={20} aria-hidden="true" /> : null}
      <h2>{title}</h2>
      <p>{detail}</p>
      {onRetry ? <button type="button" onClick={onRetry}><RefreshCw size={13} aria-hidden="true" />Retry</button> : null}
    </section>
  )
}

export function NewsPlatformRefreshStrip({
  classNamePrefix,
  message,
  error = false,
  onRetry,
}: {
  readonly classNamePrefix: string
  readonly message: string
  readonly error?: boolean
  readonly onRetry?: () => void
}) {
  return (
    <div className={classes(classNamePrefix, 'refresh-strip')} data-error={error ? 'true' : 'false'} role="status">
      <span>{message}</span>
      {onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}
    </div>
  )
}
