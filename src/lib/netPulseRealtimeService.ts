import { supabase } from './supabase'

let pulseChannelSequence = 0

export interface NetPulseRealtimeEvent {
  readonly contentRevision: number
  readonly profileRevision: number
  readonly engagementRevision: number
  readonly notificationRevision: number
  readonly entity?: string
  readonly operation?: string
  readonly resourceId?: string
}

interface RealtimeStateRow {
  readonly content_revision?: number
  readonly profile_revision?: number
  readonly engagement_revision?: number
  readonly notification_revision?: number
  readonly last_entity?: string | null
  readonly last_operation?: string | null
  readonly last_resource_id?: string | null
}

function nextChannelName(): string {
  pulseChannelSequence += 1
  return `net-pulse:state:${pulseChannelSequence}`
}

function parseRevision(value: unknown): number {
  const revision = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0
}

/**
 * PULSE uses one RLS-safe revision-row subscription. Payload metadata is only
 * an invalidation hint; every visible result is reconciled through an RPC.
 */
export function subscribeToNetPulseInvalidations(
  onInvalidate: (event: NetPulseRealtimeEvent) => void,
  onConnectionIssue?: () => void,
): () => void {
  if (!supabase) return () => {}
  const client = supabase
  const channel = client
    .channel(nextChannelName())
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'net_pulse_realtime_state',
        filter: 'channel=eq.public',
      },
      (payload) => {
        const row = (payload.new ?? {}) as RealtimeStateRow
        onInvalidate({
          contentRevision: parseRevision(row.content_revision),
          profileRevision: parseRevision(row.profile_revision),
          engagementRevision: parseRevision(row.engagement_revision),
          notificationRevision: parseRevision(row.notification_revision),
          ...(typeof row.last_entity === 'string' ? { entity: row.last_entity } : {}),
          ...(typeof row.last_operation === 'string' ? { operation: row.last_operation } : {}),
          ...(typeof row.last_resource_id === 'string' ? { resourceId: row.last_resource_id } : {}),
        })
      },
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onConnectionIssue?.()
    })

  return () => { void client.removeChannel(channel) }
}
