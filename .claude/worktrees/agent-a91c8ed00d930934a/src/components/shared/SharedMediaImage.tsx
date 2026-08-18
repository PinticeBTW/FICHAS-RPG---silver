import { useCallback, useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react'
import {
  invalidateSharedMediaReference,
  resolveSharedMediaUrl,
} from '../../lib/media/mediaStorage'
import { SHARED_MEDIA_REFERENCE_PREFIX } from '../../lib/media/mediaTypes'

interface SharedMediaImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  readonly source: string
  readonly variant?: 'display' | 'thumbnail'
  readonly fallback?: ReactNode
  readonly loadingFallback?: ReactNode
  readonly errorFallback?: ReactNode | ((retry: () => void) => ReactNode)
}

interface SharedMediaImageState {
  readonly requestKey: string
  readonly status: 'loading' | 'ready' | 'failed'
  readonly url?: string
}

export function SharedMediaImage({
  source,
  variant = 'display',
  fallback = null,
  loadingFallback,
  errorFallback,
  onError,
  ...imageProps
}: SharedMediaImageProps) {
  const sharedReference = source.startsWith(SHARED_MEDIA_REFERENCE_PREFIX)
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${attempt}:${variant}:${source}`
  const [state, setState] = useState<SharedMediaImageState>(() => ({ requestKey, status: 'loading' }))

  const retry = useCallback(() => {
    invalidateSharedMediaReference(source)
    setAttempt((value) => value + 1)
  }, [source])

  useEffect(() => {
    let current = true
    void resolveSharedMediaUrl(source, variant)
      .then((url) => {
        if (current) setState(url
          ? { requestKey, status: 'ready', url }
          : { requestKey, status: 'failed' })
      })
      .catch(() => {
        if (current) setState({ requestKey, status: 'failed' })
      })
    return () => { current = false }
  }, [requestKey, source, variant])

  // Existing HTTP/data/blob URLs remain readable with no async transition.
  if (!sharedReference) return <img {...imageProps} src={source} onError={onError} />
  if (state.requestKey !== requestKey || state.status === 'loading') {
    return <>{loadingFallback ?? fallback}</>
  }
  if (state.status === 'failed' || !state.url) {
    return <>{typeof errorFallback === 'function'
      ? errorFallback(retry)
      : errorFallback ?? fallback}</>
  }
  return (
    <img
      {...imageProps}
      src={state.url}
      onError={(event) => {
        setState({ requestKey, status: 'failed' })
        onError?.(event)
      }}
    />
  )
}
