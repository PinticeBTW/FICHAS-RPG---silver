import type { NetAltaraNewsRealtimeStatus } from './netAltaraNewsTypes'
import { supabase } from './supabase'

interface Subscriber {
  readonly onRevision: (
    articleChanged: boolean,
    liveChanged: boolean,
    broadcastChanged: boolean,
  ) => void
  readonly onStatus: (status: NetAltaraNewsRealtimeStatus) => void
}

interface RevisionRow {
  readonly article_revision?: unknown
  readonly live_revision?: unknown
  readonly broadcast_revision?: unknown
}

const subscribers = new Set<Subscriber>()
let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let status: NetAltaraNewsRealtimeStatus = 'idle'
let sequence = 0

function revision(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function publishStatus(next: NetAltaraNewsRealtimeStatus) {
  status = next
  subscribers.forEach((subscriber) => subscriber.onStatus(next))
}

function ensureChannel() {
  if (!supabase || channel || subscribers.size === 0) return
  const client = supabase
  sequence += 1
  publishStatus('connecting')
  const active = client
    .channel(`net-altara-news:revision:${sequence}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'net_altara_news_realtime_state',
      filter: 'channel=eq.public',
    }, (payload) => {
      const current = (payload.new ?? {}) as RevisionRow
      const previous = (payload.old ?? {}) as RevisionRow
      const articleChanged = revision(current.article_revision) !== revision(previous.article_revision)
      const liveChanged = revision(current.live_revision) !== revision(previous.live_revision)
      const broadcastChanged = revision(current.broadcast_revision) !== revision(previous.broadcast_revision)
      if (!articleChanged && !liveChanged && !broadcastChanged) return
      subscribers.forEach((subscriber) => subscriber.onRevision(
        articleChanged,
        liveChanged,
        broadcastChanged,
      ))
    })
  channel = active
  active.subscribe((nextStatus) => {
    if (channel !== active) return
    if (nextStatus === 'SUBSCRIBED') publishStatus('subscribed')
    else if (nextStatus === 'CHANNEL_ERROR' || nextStatus === 'TIMED_OUT' || nextStatus === 'CLOSED') {
      publishStatus('disconnected')
    }
  })
}

export function subscribeToNetAltaraNews(
  onRevision: Subscriber['onRevision'],
  onStatus: Subscriber['onStatus'],
) {
  if (!supabase) {
    onStatus('disconnected')
    return () => {}
  }
  const client = supabase
  const subscriber = { onRevision, onStatus }
  subscribers.add(subscriber)
  onStatus(status)
  ensureChannel()
  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size > 0 || !channel) return
    const retired = channel
    channel = null
    status = 'idle'
    void client.removeChannel(retired)
  }
}
