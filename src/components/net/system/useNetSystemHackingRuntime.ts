import { useCallback, useEffect, useRef, useState } from 'react'

import type { NetResolvedIdentity } from '../identity/netIdentityTypes'
import {
  NET_SYSTEM_HACKING_ENTERED_CHANGED_EVENT,
  isNetSystemHackingEnteredStorageEvent,
  readNetSystemHackingEntered,
  writeNetSystemHackingEntered,
} from '../../../lib/netSystemHackingEnteredStore'
import {
  endNetSystemHackingSession,
  fetchNetSystemHackingSession,
  fetchNetSystemHackingTargetResolvedIdentity,
  type NetSystemHackingSessionState,
} from '../../../lib/netSystemHackingService'

type NetSystemHackingTargetIdentityState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly identity: NetResolvedIdentity }
  | { readonly status: 'error'; readonly reason: string }

export interface NetSystemHackingRuntimeState {
  readonly sessionStatus: 'loading' | 'ready' | 'error'
  readonly sessionError?: string
  readonly session: NetSystemHackingSessionState | null
  /** Purely a client-side "looking at the target's desktop right now" toggle. */
  readonly entered: boolean
  /** session?.active && entered -- the target's OS should be mounted. */
  readonly mounted: boolean
  readonly targetIdentity: NetSystemHackingTargetIdentityState | null
  readonly enter: () => void
  readonly exit: () => void
  readonly disconnect: () => Promise<void>
  readonly disconnecting: boolean
  readonly disconnectError: string | null
  readonly refresh: () => Promise<NetSystemHackingSessionState | null>
}

/**
 * Single shared source of truth for "is the current player's own hacking
 * session active, and are they currently looking at the target's desktop."
 * Consumed by NetSystemSecurityControl (ENTER SYSTEM / DISCONNECT UI),
 * NetOsEntryPage (which OS component to mount), and NetHubPage /
 * AltaraOsGateway (which identity's data that mounted OS renders).
 *
 * The server-side session.active flag (from fetch_net_system_hacking_
 * session(), always source-anchored -- see net-system-hacking-runtime-
 * projection.sql) is the sole authority for whether hacking access exists.
 * "entered" is a purely client-side, per-profile toggle (net_system_
 * hacking_entered_store: localStorage + a same-tab CustomEvent, mirroring
 * net_gm_workspace_store's established pattern for "which OS environment
 * to render" preferences) for whether the player is currently looking at
 * the target's desktop vs their own right now -- it never grants or
 * removes any authority by itself, and a stale "entered" left over after
 * the session already ended is harmless: every consumer only treats it as
 * meaningful when combined with session.active.
 */
export function useNetSystemHackingRuntime(profileId?: string): NetSystemHackingRuntimeState {
  const [session, setSession] = useState<NetSystemHackingSessionState | null>(null)
  const [sessionStatus, setSessionStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [sessionError, setSessionError] = useState<string | undefined>(undefined)
  const [entered, setEntered] = useState(() => (profileId ? readNetSystemHackingEntered(profileId) : false))
  const [targetIdentity, setTargetIdentity] = useState<NetSystemHackingTargetIdentityState | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)
  const requestRef = useRef(0)

  const loadSession = useCallback(() => {
    const requestId = ++requestRef.current
    setSessionStatus('loading')
    return fetchNetSystemHackingSession()
      .then((next) => {
        if (requestRef.current !== requestId) return next
        setSession(next)
        setSessionStatus('ready')
        return next
      })
      .catch((caught) => {
        if (requestRef.current !== requestId) return null
        setSessionStatus('error')
        setSessionError(caught instanceof Error ? caught.message : 'Hacking session status could not be loaded.')
        return null
      })
  }, [])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  useEffect(() => {
    setEntered(profileId ? readNetSystemHackingEntered(profileId) : false)
    if (!profileId) return undefined

    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ profileId: string; entered: boolean }>).detail
      if (detail?.profileId === profileId) setEntered(detail.entered)
    }
    const handleStorage = (event: StorageEvent) => {
      if (isNetSystemHackingEnteredStorageEvent(event, profileId)) {
        setEntered(readNetSystemHackingEntered(profileId))
      }
    }
    window.addEventListener(NET_SYSTEM_HACKING_ENTERED_CHANGED_EVENT, handleChange)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(NET_SYSTEM_HACKING_ENTERED_CHANGED_EVENT, handleChange)
      window.removeEventListener('storage', handleStorage)
    }
  }, [profileId])

  const mounted = Boolean(session?.active) && entered

  useEffect(() => {
    if (!mounted) {
      setTargetIdentity(null)
      return undefined
    }
    let cancelled = false
    setTargetIdentity({ status: 'loading' })
    void fetchNetSystemHackingTargetResolvedIdentity()
      .then((identity) => {
        if (cancelled) return
        setTargetIdentity({ status: 'ready', identity })
      })
      .catch((caught) => {
        if (cancelled) return
        setTargetIdentity({
          status: 'error',
          reason: caught instanceof Error ? caught.message : 'The compromised identity could not be resolved.',
        })
      })
    return () => { cancelled = true }
  }, [mounted])

  const enter = useCallback(() => {
    if (profileId) writeNetSystemHackingEntered(profileId, true)
  }, [profileId])

  const exit = useCallback(() => {
    if (profileId) writeNetSystemHackingEntered(profileId, false)
  }, [profileId])

  const disconnect = useCallback(async () => {
    if (disconnecting) return
    setDisconnecting(true)
    setDisconnectError(null)
    try {
      await endNetSystemHackingSession()
      if (profileId) writeNetSystemHackingEntered(profileId, false)
      setSession({ active: false })
    } catch (caught) {
      setDisconnectError(caught instanceof Error ? caught.message : 'The hacking session could not be ended.')
    } finally {
      setDisconnecting(false)
    }
  }, [disconnecting, profileId])

  return {
    sessionStatus,
    sessionError,
    session,
    entered,
    mounted,
    targetIdentity,
    enter,
    exit,
    disconnect,
    disconnecting,
    disconnectError,
    refresh: loadSession,
  }
}
