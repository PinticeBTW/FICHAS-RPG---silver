import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchNetNvnLiveDesk } from '../../lib/netNvnLiveService'
import type { NetNvnLiveDesk } from '../../lib/netNvnLiveTypes'

type LiveDeskPhase = 'idle' | 'loading' | 'ready' | 'failed'

export function useNetNvnLiveDesk(
  enabled: boolean,
  realtimeInvalidationVersion: number,
) {
  const [phase, setPhase] = useState<LiveDeskPhase>('idle')
  const [desk, setDesk] = useState<NetNvnLiveDesk | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequenceRef = useRef(0)
  const lastRealtimeVersionRef = useRef(realtimeInvalidationVersion)
  const deskRef = useRef<NetNvnLiveDesk | null>(null)

  useEffect(() => {
    deskRef.current = desk
  }, [desk])

  const load = useCallback(async (preserveConfirmed: boolean) => {
    if (!enabled) return
    const sequence = ++requestSequenceRef.current
    if (preserveConfirmed && deskRef.current) setRefreshing(true)
    else setPhase('loading')
    setError(null)
    try {
      const loaded = await fetchNetNvnLiveDesk()
      if (requestSequenceRef.current !== sequence) return
      deskRef.current = loaded
      setDesk(loaded)
      setPhase('ready')
      setRefreshing(false)
    } catch {
      if (requestSequenceRef.current !== sequence) return
      if (deskRef.current && preserveConfirmed) {
        setPhase('ready')
        setRefreshing(false)
      } else {
        deskRef.current = null
        setDesk(null)
        setPhase('failed')
      }
      setError('The authoritative NVN live ledger could not be reached. Check the connection and retry.')
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      requestSequenceRef.current += 1
      return undefined
    }
    void load(Boolean(deskRef.current))
    return () => {
      requestSequenceRef.current += 1
    }
  }, [enabled, load])

  useEffect(() => {
    if (!enabled) {
      lastRealtimeVersionRef.current = realtimeInvalidationVersion
      return
    }
    if (realtimeInvalidationVersion <= lastRealtimeVersionRef.current) return
    lastRealtimeVersionRef.current = realtimeInvalidationVersion
    void load(Boolean(deskRef.current))
  }, [enabled, load, realtimeInvalidationVersion])

  return {
    phase,
    desk,
    refreshing,
    error,
    retry: () => load(Boolean(deskRef.current)),
  }
}
