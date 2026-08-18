import type { MouseEvent, ReactNode } from 'react'

import { normalizeNetHandle } from './accounts/netAppAccountSelectors'
import type { PulsePostData } from './pulseData'

interface PulseMentionTextProps {
  readonly text: string
  readonly mentions?: PulsePostData['mentions']
  readonly onOpenProfile: (accountId: string) => void
}

/**
 * Renders server-resolved mention UUIDs as React nodes. Unknown @tokens remain
 * ordinary text; no authored content is ever interpreted as HTML.
 */
export function PulseMentionText({ text, mentions, onOpenProfile }: PulseMentionTextProps) {
  if (!mentions?.length) return text
  const resolvedBySource = new Map(
    mentions.map((mention) => [mention.sourceHandle, mention]),
  )
  const nodes: ReactNode[] = []
  const mentionToken = /(^|[^A-Za-z0-9_.@-])@([A-Za-z0-9_.-]+)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = mentionToken.exec(text)) !== null) {
    const sourceHandle = normalizeNetHandle(match[2] ?? '')
    const mention = sourceHandle ? resolvedBySource.get(sourceHandle) : undefined
    if (!mention) continue

    const prefix = match[1] ?? ''
    const mentionStart = match.index + prefix.length
    if (mentionStart > cursor) nodes.push(text.slice(cursor, mentionStart))
    nodes.push(
      <button
        key={`${mention.accountId}:${mentionStart}`}
        type="button"
        className="pulse-mention"
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          event.stopPropagation()
          onOpenProfile(mention.accountId)
        }}
        aria-label={`Open @${mention.currentHandle}'s PULSE profile`}
      >
        @{mention.currentHandle}
      </button>,
    )
    cursor = mentionToken.lastIndex
  }

  if (cursor === 0) return text
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}
