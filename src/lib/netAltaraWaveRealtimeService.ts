import type { NetAltaraWaveRealtimeEvent } from './netAltaraWaveTypes'
import { supabase } from './supabase'

let waveChannelSequence = 0

interface RealtimeRow {
  readonly content_revision?: number
  readonly profile_revision?: number
  readonly engagement_revision?: number
  readonly notification_revision?: number
  readonly last_entity?: string | null
  readonly last_operation?: string | null
  readonly last_resource_id?: string | null
}

function revision(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

/** One revision-row channel for the complete WAVE module. */
export function subscribeToNetAltaraWaveInvalidations(
  onInvalidate: (event: NetAltaraWaveRealtimeEvent) => void,
  onConnectionIssue?: () => void,
): () => void {
  if (!supabase) return () => {}
  waveChannelSequence += 1
  const client = supabase
  const channel = client
    .channel(`net-altara-wave:state:${waveChannelSequence}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'net_altara_wave_realtime_state',
      filter: 'channel=eq.public',
    }, (payload) => {
      const row = (payload.new ?? {}) as RealtimeRow
      onInvalidate({
        contentRevision: revision(row.content_revision),
        profileRevision: revision(row.profile_revision),
        engagementRevision: revision(row.engagement_revision),
        notificationRevision: revision(row.notification_revision),
        ...(typeof row.last_entity === 'string' ? { entity: row.last_entity } : {}),
        ...(typeof row.last_operation === 'string' ? { operation: row.last_operation } : {}),
        ...(typeof row.last_resource_id === 'string' ? { resourceId: row.last_resource_id } : {}),
      })
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onConnectionIssue?.()
    })
  return () => { void client.removeChannel(channel) }
}
