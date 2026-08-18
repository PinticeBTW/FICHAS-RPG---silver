import { useCallback, useEffect, useRef, useState } from 'react'

import { subscribeToNetAltaraWaveInvalidations } from '../../../lib/netAltaraWaveRealtimeService'
import { fetchNetAltaraWaveSession } from '../../../lib/netAltaraWaveService'
import type { NetAltaraWaveSession } from '../../../lib/netAltaraWaveTypes'

type WaveSessionState =
  | { readonly key: string; readonly status: 'idle' | 'loading' }
  | { readonly key: string; readonly status: 'ready'; readonly session: NetAltaraWaveSession }
  | { readonly key: string; readonly status: 'error'; readonly reason: string }

/**
 * Exact runtime-scoped WAVE session. Prop/key mismatches render as loading, so
 * a late Adrian response cannot paint into an Ayin control session.
 */
export function useNetAltaraWave(
  enabled: boolean,
  identitySessionKey: string,
  expectedIdentityLinkId?: string,
) {
  const requestKey = `${identitySessionKey}:${expectedIdentityLinkId ?? 'none'}`
  const [state, setState] = useState<WaveSessionState>({ key: requestKey, status: 'idle' })
  const [revision, setRevision] = useState(0)
  const generationRef = useRef(0)
  const refreshRef = useRef<() => void>(() => undefined)

  const refresh = useCallback(() => refreshRef.current(), [])

  useEffect(() => {
    generationRef.current += 1
    const generation = generationRef.current
    let active = true
    let coalesceTimer: ReturnType<typeof setTimeout> | undefined

    const load = () => {
      if (!enabled || !expectedIdentityLinkId) {
        setState({ key: requestKey, status: 'idle' })
        return
      }
      setState((current) => current.key === requestKey && current.status === 'ready'
        ? current
        : { key: requestKey, status: 'loading' })
      void fetchNetAltaraWaveSession(expectedIdentityLinkId)
        .then((session) => {
          if (!active || generationRef.current !== generation) return
          if (session.identityLinkId !== expectedIdentityLinkId) {
            throw new Error('WAVE returned a different runtime identity.')
          }
          setState({ key: requestKey, status: 'ready', session })
        })
        .catch((error: unknown) => {
          if (!active || generationRef.current !== generation) return
          setState({
            key: requestKey,
            status: 'error',
            reason: error instanceof Error ? error.message : 'WAVE could not resolve this identity.',
          })
        })
    }

    refreshRef.current = load
    load()
    const unsubscribe = enabled && expectedIdentityLinkId
      ? subscribeToNetAltaraWaveInvalidations(() => {
          if (!active || coalesceTimer) return
          coalesceTimer = setTimeout(() => {
            coalesceTimer = undefined
            if (!active || generationRef.current !== generation) return
            load()
            setRevision((value) => value + 1)
          }, 120)
        }, () => {
          if (active) setRevision((value) => value + 1)
        })
      : () => undefined

    return () => {
      active = false
      if (coalesceTimer) clearTimeout(coalesceTimer)
      unsubscribe()
    }
  }, [enabled, expectedIdentityLinkId, requestKey])

  const visibleState: WaveSessionState = state.key === requestKey
    ? state
    : { key: requestKey, status: enabled && expectedIdentityLinkId ? 'loading' : 'idle' }

  return { state: visibleState, revision, refresh }
}
