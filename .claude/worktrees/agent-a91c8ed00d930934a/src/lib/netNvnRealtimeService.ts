import { supabase } from './supabase'

let nvnChannelSequence = 0

export type NetNvnRealtimeConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'subscribed'
  | 'disconnected'

interface NetNvnRealtimeStateRow {
  readonly article_revision?: number | string
  readonly live_revision?: number | string
  readonly radio_revision?: number | string
}

export interface NetNvnRealtimeInvalidation {
  readonly articleRevision: number
  readonly liveRevision: number
  readonly radioRevision: number
  readonly articleChanged: boolean
  readonly liveChanged: boolean
  readonly radioChanged: boolean
}

function nextChannelName(): string {
  nvnChannelSequence += 1
  return `net-nvn:state:${nvnChannelSequence}`
}

function parseRevision(value: unknown): number {
  const revision = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0
}

/**
 * NVN exposes one metadata-free revision row. Every article projection still
 * comes from the bounded authenticated RPCs; Realtime carries no article IDs,
 * lifecycle state, editor identity, headline, or body.
 */
export function subscribeToNetNvnInvalidations(
  onRevision: (invalidation: NetNvnRealtimeInvalidation) => void,
  onStatus: (status: NetNvnRealtimeConnectionStatus) => void,
): () => void {
  if (!supabase) {
    onStatus('disconnected')
    return () => {}
  }

  const client = supabase
  onStatus('connecting')
  const channel = client
    .channel(nextChannelName())
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'net_nvn_realtime_state',
        filter: 'channel=eq.public',
      },
      (payload) => {
        const row = (payload.new ?? {}) as NetNvnRealtimeStateRow
        const previous = (payload.old ?? {}) as NetNvnRealtimeStateRow
        const articleRevision = parseRevision(row.article_revision)
        const liveRevision = parseRevision(row.live_revision)
        const radioRevision = parseRevision(row.radio_revision)
        const hasPreviousArticleRevision = previous.article_revision !== undefined
        const hasPreviousLiveRevision = previous.live_revision !== undefined
        const hasPreviousRadioRevision = previous.radio_revision !== undefined
        onRevision({
          articleRevision,
          liveRevision,
          radioRevision,
          articleChanged: hasPreviousArticleRevision
            ? articleRevision !== parseRevision(previous.article_revision)
            : articleRevision > 0,
          liveChanged: hasPreviousLiveRevision
            ? liveRevision !== parseRevision(previous.live_revision)
            : false,
          radioChanged: hasPreviousRadioRevision
            ? radioRevision !== parseRevision(previous.radio_revision)
            : false,
        })
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        onStatus('subscribed')
      } else if (
        status === 'CHANNEL_ERROR'
        || status === 'TIMED_OUT'
        || status === 'CLOSED'
      ) {
        onStatus('disconnected')
      }
    })

  return () => { void client.removeChannel(channel) }
}
