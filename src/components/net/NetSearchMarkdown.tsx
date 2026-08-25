import { memo, useEffect, useMemo, useState, useTransition } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'

interface NetSearchMarkdownProps {
  readonly content: string
  readonly compact?: boolean
}

const ALLOWED_MARKDOWN_ELEMENTS = [
  'h1', 'h2', 'h3', 'p', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote',
  'a', 'hr', 'code', 'pre', 'br',
]
const MARKDOWN_RENDER_SEGMENT_SIZE = 24_000

function safeMarkdownUrl(url: string): string {
  const transformed = defaultUrlTransform(url)
  if (!transformed) return ''
  const normalized = transformed.trim().toLocaleLowerCase()
  if (normalized.startsWith('//')) return ''
  if (
    normalized.startsWith('https://')
    || normalized.startsWith('http://')
    || normalized.startsWith('mailto:')
    || normalized.startsWith('#')
    || normalized.startsWith('/')
    || normalized.startsWith('./')
    || normalized.startsWith('../')
  ) {
    return transformed
  }
  return ''
}

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => {
    if (!href) return <span>{children}</span>
    const external = /^https?:\/\//iu.test(href)
    return (
      <a
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
      >
        {children}
      </a>
    )
  },
}

function splitMarkdownForRendering(content: string): readonly string[] {
  if (content.length <= MARKDOWN_RENDER_SEGMENT_SIZE) return [content]
  const blocks = content.split(/\n{2,}/)
  const segments: string[] = []
  let buffer = ''

  for (const block of blocks) {
    const next = buffer ? `${buffer}\n\n${block}` : block
    if (next.length <= MARKDOWN_RENDER_SEGMENT_SIZE) {
      buffer = next
      continue
    }
    if (buffer) segments.push(buffer)
    if (block.length <= MARKDOWN_RENDER_SEGMENT_SIZE) {
      buffer = block
      continue
    }
    for (let start = 0; start < block.length; start += MARKDOWN_RENDER_SEGMENT_SIZE) {
      segments.push(block.slice(start, start + MARKDOWN_RENDER_SEGMENT_SIZE))
    }
    buffer = ''
  }
  if (buffer) segments.push(buffer)
  return segments.length > 0 ? segments : ['']
}

const MarkdownSegment = memo(function MarkdownSegment({ content }: { readonly content: string }) {
  return (
    <Markdown
      allowedElements={ALLOWED_MARKDOWN_ELEMENTS}
      skipHtml
      urlTransform={safeMarkdownUrl}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </Markdown>
  )
})

function NetSearchMarkdownBody({ content, compact }: Required<NetSearchMarkdownProps>) {
  const segments = useMemo(
    () => compact ? [content] : splitMarkdownForRendering(content),
    [compact, content],
  )
  const [visibleSegments, setVisibleSegments] = useState(1)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (visibleSegments >= segments.length) return
    const timer = window.setTimeout(() => {
      startTransition(() => {
        setVisibleSegments((current) => Math.min(current + 1, segments.length))
      })
    }, 24)
    return () => window.clearTimeout(timer)
  }, [segments.length, startTransition, visibleSegments])

  return (
    <div className="net-search-markdown" data-compact={compact ? 'true' : 'false'}>
      {segments.slice(0, visibleSegments).map((segment, index) => (
        <section className="net-search-markdown__segment" key={`${index}:${segment.length}`}>
          <MarkdownSegment content={segment} />
        </section>
      ))}
      {visibleSegments < segments.length ? (
        <p className="net-search-markdown__loading" role="status">
          Formatting lore… {visibleSegments}/{segments.length}
        </p>
      ) : null}
    </div>
  )
}

export default function NetSearchMarkdown({ content, compact = false }: NetSearchMarkdownProps) {
  const contentKey = `${compact ? 'compact' : 'full'}:${content.length}:${content.slice(0, 32)}:${content.slice(-32)}`
  return <NetSearchMarkdownBody key={contentKey} content={content} compact={compact} />
}
