import type { NetAltaraMessengerRealtimeStatus } from './netAltaraMessengerTypes'
import { supabase } from './supabase'

let channelSequence = 0
let messengerChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let messengerStatus: NetAltaraMessengerRealtimeStatus = 'idle'

interface MessengerSubscriber {
  readonly onRevision: (identityLinkId: string, revision: number) => void
  readonly onStatus: (status: NetAltaraMessengerRealtimeStatus) => void
}

const subscribers = new Set<MessengerSubscriber>()

function publishStatus(status: NetAltaraMessengerRealtimeStatus) {
  messengerStatus = status
  for (const subscriber of subscribers) subscriber.onStatus(status)
}

function ensureChannel() {
  if (!supabase || messengerChannel) return
  channelSequence += 1
  const client = supabase
  publishStatus('connecting')
  const channel = client
    .channel(`net-altara-messenger:revisions:${channelSequence}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'net_altara_messenger_realtime_state',
      },
      (payload) => {
        const row = payload.new as {
          identity_link_id?: unknown
          revision?: unknown
        } | null
        const identityLinkId = typeof row?.identity_link_id === 'string'
          ? row.identity_link_id
          : ''
        const revision = typeof row?.revision === 'number'
          ? row.revision
          : Number(row?.revision)
        if (!identityLinkId || !Number.isSafeInteger(revision) || revision < 0) return
        for (const subscriber of subscribers) subscriber.onRevision(identityLinkId, revision)
      },
    )
  messengerChannel = channel
  channel.subscribe((status) => {
    if (messengerChannel !== channel) return
    if (status === 'SUBSCRIBED') publishStatus('subscribed')
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      publishStatus('disconnected')
    }
  })
}

export function subscribeToNetAltaraMessenger(
  onRevision: (identityLinkId: string, revision: number) => void,
  onStatus: (status: NetAltaraMessengerRealtimeStatus) => void,
): () => void {
  if (!supabase) {
    onStatus('disconnected')
    return () => {}
  }

  const client = supabase
  const subscriber = { onRevision, onStatus }
  subscribers.add(subscriber)
  onStatus(messengerStatus)
  ensureChannel()

  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size > 0 || !messengerChannel) return
    const retiredChannel = messengerChannel
    messengerChannel = null
    messengerStatus = 'idle'
    void client.removeChannel(retiredChannel)
  }
}
