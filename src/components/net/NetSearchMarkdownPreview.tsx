import { lazy, Suspense } from 'react'

const NetSearchMarkdown = lazy(() => import('./NetSearchMarkdown'))

interface NetSearchMarkdownPreviewProps {
  readonly content: string
  readonly compact?: boolean
  readonly fallback?: string
}

export function NetSearchMarkdownPreview({
  content,
  compact = false,
  fallback = 'Formatting lore…',
}: NetSearchMarkdownPreviewProps) {
  return (
    <Suspense fallback={<p className="net-search-markdown__loading">{fallback}</p>}>
      <NetSearchMarkdown content={content} compact={compact} />
    </Suspense>
  )
}
