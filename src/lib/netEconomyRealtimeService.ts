import { supabase } from './supabase'

let economyChannelSequence = 0
let economyChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let economyStatus: NetEconomyRealtimeStatus = 'idle'
let economyRecoveryAttempted = false
let economyLifecycleListenersAttached = false

interface EconomySubscriber {
  readonly onRevision: (accountId: string, revision: number) => void
  readonly onStatus: (status: NetEconomyRealtimeStatus) => void
}

const economySubscribers = new Set<EconomySubscriber>()

export type NetEconomyRealtimeStatus = 'idle' | 'connecting' | 'subscribed' | 'disconnected'

function publishStatus(status: NetEconomyRealtimeStatus) {
  economyStatus = status
  for (const subscriber of economySubscribers) subscriber.onStatus(status)
}

function reconcileEconomyChannel() {
  if (!economySubscribers.size || economyStatus !== 'disconnected' || economyChannel) return
  economyRecoveryAttempted = false
  ensureEconomyChannel()
}

function handleEconomyVisibilityChange() {
  if (document.visibilityState === 'visible') reconcileEconomyChannel()
}

function attachEconomyLifecycleListeners() {
  if (economyLifecycleListenersAttached || typeof window === 'undefined') return
  economyLifecycleListenersAttached = true
  window.addEventListener('online', reconcileEconomyChannel)
  window.addEventListener('focus', reconcileEconomyChannel)
  document.addEventListener('visibilitychange', handleEconomyVisibilityChange)
}

function detachEconomyLifecycleListeners() {
  if (!economyLifecycleListenersAttached || typeof window === 'undefined') return
  economyLifecycleListenersAttached = false
  window.removeEventListener('online', reconcileEconomyChannel)
  window.removeEventListener('focus', reconcileEconomyChannel)
  document.removeEventListener('visibilitychange', handleEconomyVisibilityChange)
}

function ensureEconomyChannel() {
  if (!supabase || economyChannel) return
  economyChannelSequence += 1
  const client = supabase
  publishStatus('connecting')
  const channel = client
    .channel(`net-economy:wallet:${economyChannelSequence}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'net_economy_wallet_realtime_state',
      },
      (payload) => {
        const row = payload.new as { account_id?: unknown; revision?: unknown } | null
        const accountId = typeof row?.account_id === 'string' ? row.account_id : ''
        if (!accountId) return
        const raw = row?.revision
        const revision = typeof raw === 'number' ? raw : Number(raw)
        if (!Number.isSafeInteger(revision) || revision < 0) return
        for (const subscriber of economySubscribers) subscriber.onRevision(accountId, revision)
      },
    )
  economyChannel = channel
  channel.subscribe((status) => {
    if (economyChannel !== channel) return
    if (status === 'SUBSCRIBED') {
      economyRecoveryAttempted = false
      publishStatus('subscribed')
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      economyChannel = null
      publishStatus('disconnected')
      const shouldRecover = economySubscribers.size > 0 && !economyRecoveryAttempted
      economyRecoveryAttempted = true
      void client.removeChannel(channel).finally(() => {
        if (shouldRecover && economySubscribers.size > 0 && !economyChannel) ensureEconomyChannel()
      })
    }
  })
}

export function subscribeToNetEconomyWallet(
  onRevision: (accountId: string, revision: number) => void,
  onStatus: (status: NetEconomyRealtimeStatus) => void,
): () => void {
  if (!supabase) {
    onStatus('disconnected')
    return () => {}
  }

  const client = supabase
  const subscriber = { onRevision, onStatus }
  economySubscribers.add(subscriber)
  attachEconomyLifecycleListeners()
  onStatus(economyStatus)
  ensureEconomyChannel()

  return () => {
    economySubscribers.delete(subscriber)
    if (economySubscribers.size > 0) return
    detachEconomyLifecycleListeners()
    economyRecoveryAttempted = false
    if (!economyChannel) {
      economyStatus = 'idle'
      return
    }
    const retiredChannel = economyChannel
    economyChannel = null
    economyStatus = 'idle'
    void client.removeChannel(retiredChannel)
  }
}
