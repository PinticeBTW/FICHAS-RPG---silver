import type { NetVeilMessengerRealtimeStatus } from './netVeilMessengerTypes'
import { supabase } from './supabase'

let channelSequence = 0
let messengerChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let messengerStatus: NetVeilMessengerRealtimeStatus = 'idle'
let recoveryAttempted = false
let lifecycleListenersAttached = false

interface MessengerSubscriber {
  readonly onRevision: (identityLinkId: string, revision: number) => void
  readonly onStatus: (status: NetVeilMessengerRealtimeStatus) => void
}

const subscribers = new Set<MessengerSubscriber>()

function publishStatus(status: NetVeilMessengerRealtimeStatus) {
  messengerStatus = status
  for (const subscriber of subscribers) subscriber.onStatus(status)
}

function reconcileChannel() {
  if (!subscribers.size || messengerStatus !== 'disconnected' || messengerChannel) return
  recoveryAttempted = false
  ensureChannel()
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') reconcileChannel()
}

function attachLifecycleListeners() {
  if (lifecycleListenersAttached || typeof window === 'undefined') return
  lifecycleListenersAttached = true
  window.addEventListener('online', reconcileChannel)
  window.addEventListener('focus', reconcileChannel)
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

function detachLifecycleListeners() {
  if (!lifecycleListenersAttached || typeof window === 'undefined') return
  lifecycleListenersAttached = false
  window.removeEventListener('online', reconcileChannel)
  window.removeEventListener('focus', reconcileChannel)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
}

function ensureChannel() {
  if (!supabase || messengerChannel) return
  channelSequence += 1
  const client = supabase
  publishStatus('connecting')
  const channel = client
    .channel(`net-veil-messenger:revisions:${channelSequence}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'net_veil_messenger_realtime_state',
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
    if (status === 'SUBSCRIBED') {
      recoveryAttempted = false
      publishStatus('subscribed')
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      messengerChannel = null
      publishStatus('disconnected')
      // A revision bump delivered while this channel is dead is never
      // replayed. Without an explicit recreate, a former member's own
      // removal signal (and any later membership change) can be silently
      // lost for the rest of the session once the socket drops.
      const shouldRecover = subscribers.size > 0 && !recoveryAttempted
      recoveryAttempted = true
      void client.removeChannel(channel).finally(() => {
        if (shouldRecover && subscribers.size > 0 && !messengerChannel) ensureChannel()
      })
    }
  })
}

export function subscribeToNetVeilMessenger(
  onRevision: (identityLinkId: string, revision: number) => void,
  onStatus: (status: NetVeilMessengerRealtimeStatus) => void,
): () => void {
  if (!supabase) {
    onStatus('disconnected')
    return () => {}
  }

  const client = supabase
  const subscriber = { onRevision, onStatus }
  subscribers.add(subscriber)
  attachLifecycleListeners()
  onStatus(messengerStatus)
  ensureChannel()

  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size > 0) return
    detachLifecycleListeners()
    recoveryAttempted = false
    if (!messengerChannel) {
      messengerStatus = 'idle'
      return
    }
    const retiredChannel = messengerChannel
    messengerChannel = null
    messengerStatus = 'idle'
    void client.removeChannel(retiredChannel)
  }
}
