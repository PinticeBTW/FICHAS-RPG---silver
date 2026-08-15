import { NewsPlatformFeedback, NewsPlatformRefreshStrip } from './news/NewsPlatformFeedback'

export function NvnReaderFeedback(props: {
  readonly title: string
  readonly detail: string
  readonly loading?: boolean
  readonly error?: boolean
  readonly onRetry?: () => void
}) {
  return <NewsPlatformFeedback classNamePrefix="nvn" {...props} />
}

export function NvnRefreshStrip(props: {
  readonly message: string
  readonly error?: boolean
  readonly onRetry?: () => void
}) {
  return <NewsPlatformRefreshStrip classNamePrefix="nvn" {...props} />
}
