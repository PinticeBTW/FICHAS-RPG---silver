import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  fetchNetPulseProfile,
  saveNetPulseProfile,
  saveNetPulseProfileAsCompromised,
  type NetPulseProfile,
  type NetPulsePublicProfileInput,
} from '../../lib/netPulseProfileService'
import {
  isNetPulseContextChangedError,
  type NetPulseRequestContext,
} from '../../lib/netPulseRequestContext'

export type NetPulseProfileControlMode = 'owner' | 'compromised' | 'read-only'

type NetPulseProfileState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly accountId: string }
  | { readonly status: 'ready'; readonly profile: NetPulseProfile }
  | { readonly status: 'error'; readonly accountId: string; readonly reason: string }

/**
 * One request per account key with stale-response protection. Public PULSE
 * remains usable while this account-owned profile detail synchronizes.
 */
export function useNetPulseProfile(
  accountId: string | null,
  fallbackHandle: string | undefined,
  controlMode: NetPulseProfileControlMode,
  authoritativeRevision: number,
  requestContext: NetPulseRequestContext,
  onContextMismatch?: (error: Error) => void,
) {
  const [state, setState] = useState<NetPulseProfileState>({ status: 'idle' })
  const [saving, setSaving] = useState(false)
  const accountIdRef = useRef(accountId)
  const savingRef = useRef(false)
  const requestContextRef = useRef(requestContext)
  accountIdRef.current = accountId
  requestContextRef.current = requestContext

  useEffect(() => {
    if (!accountId) {
      setState({ status: 'idle' })
      setSaving(false)
      savingRef.current = false
      return undefined
    }

    const expectedAccountId = accountId
    let cancelled = false
    setState((current) => current.status === 'ready' && current.profile.accountId === expectedAccountId
      ? current
      : { status: 'loading', accountId: expectedAccountId })
    setSaving(false)
    savingRef.current = false

    void fetchNetPulseProfile(expectedAccountId, fallbackHandle, requestContext).then((profile) => {
      if (cancelled || accountIdRef.current !== expectedAccountId) return
      if (!profile) throw new Error('The PULSE account presentation is unavailable.')
      setState({ status: 'ready', profile })
    }).catch((error: unknown) => {
      if (cancelled || accountIdRef.current !== expectedAccountId) return
      if (isNetPulseContextChangedError(error)) onContextMismatch?.(error)
      setState((current) => current.status === 'ready' && current.profile.accountId === expectedAccountId
        ? current
        : {
            status: 'error',
            accountId: expectedAccountId,
            reason: error instanceof Error ? error.message : 'PULSE profile could not be synchronized.',
          })
    })

    return () => {
      cancelled = true
    }
  }, [accountId, authoritativeRevision, fallbackHandle, onContextMismatch, requestContext])

  const save = useCallback(async (input: NetPulsePublicProfileInput): Promise<NetPulseProfile> => {
    const expectedAccountId = accountIdRef.current
    if (!expectedAccountId) throw new Error('A ready PULSE account is required.')
    if (controlMode === 'read-only') throw new Error('This PULSE profile is read-only.')
    if (savingRef.current) throw new Error('A PULSE profile save is already pending.')

    savingRef.current = true
    setSaving(true)
    try {
      const compromisedContext = requestContextRef.current.compromised
      if (controlMode === 'compromised' && !compromisedContext) {
        throw new Error('An authoritative compromised PULSE session is required.')
      }
      const profile = controlMode === 'compromised'
        ? await saveNetPulseProfileAsCompromised(input, compromisedContext!)
        : await saveNetPulseProfile(expectedAccountId, input)
      if (accountIdRef.current !== expectedAccountId) {
        throw new Error('The active PULSE identity changed before the profile save completed.')
      }
      setState({ status: 'ready', profile })
      return profile
    } catch (error) {
      if (isNetPulseContextChangedError(error)) onContextMismatch?.(error)
      throw error
    } finally {
      if (accountIdRef.current === expectedAccountId) {
        savingRef.current = false
        setSaving(false)
      }
    }
  }, [controlMode, onContextMismatch])

  return useMemo(() => ({ state, saving, save }), [save, saving, state])
}
