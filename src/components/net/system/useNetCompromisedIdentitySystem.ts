import { useEffect, useRef, useState } from 'react'

import { fetchNetIdentitySystemForInspection, type NetIdentitySystemSnapshot } from '../../../lib/netIdentitySystemService'
import type { NetGmPersonaController } from '../identity/useNetGmPersona'

export type NetCompromisedIdentitySystemState =
  | { readonly status: 'unavailable' }
  | { readonly status: 'loading'; readonly identityLinkId: string }
  | { readonly status: 'ready'; readonly system: NetIdentitySystemSnapshot }
  | { readonly status: 'error'; readonly identityLinkId: string; readonly reason: string }

export interface NetCompromisedIdentitySystemController {
  readonly state: NetCompromisedIdentitySystemState
}

function failureReason(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The compromised system profile could not be mounted.'
}

/**
 * Read-only runtime mount for a server-confirmed compromised GM persona.
 * This never exposes mutation operations: authorization for the target system
 * remains entirely with the normal owner-side RPCs and Storage policies.
 */
export function useNetCompromisedIdentitySystem(
  authenticatedProfileId: string | undefined,
  gmPersona: NetGmPersonaController,
): NetCompromisedIdentitySystemController {
  const targetIdentityLinkId = gmPersona.state.status === 'compromised'
    ? gmPersona.state.identity.identityLinkId
    : undefined
  const [state, setState] = useState<NetCompromisedIdentitySystemState>({ status: 'unavailable' })
  const expectedMountRef = useRef<string | undefined>(targetIdentityLinkId)

  expectedMountRef.current = targetIdentityLinkId

  useEffect(() => {
    let cancelled = false
    const expectedIdentityLinkId = targetIdentityLinkId
    const expectedProfileId = authenticatedProfileId

    if (!expectedIdentityLinkId || !expectedProfileId) {
      setState({ status: 'unavailable' })
      return () => { cancelled = true }
    }

    setState({ status: 'loading', identityLinkId: expectedIdentityLinkId })
    void fetchNetIdentitySystemForInspection(expectedIdentityLinkId)
      .then((system) => {
        if (cancelled || expectedMountRef.current !== expectedIdentityLinkId) return
        setState({ status: 'ready', system })
      })
      .catch((error) => {
        if (cancelled || expectedMountRef.current !== expectedIdentityLinkId) return
        setState({
          status: 'error',
          identityLinkId: expectedIdentityLinkId,
          reason: failureReason(error),
        })
      })

    return () => { cancelled = true }
  }, [authenticatedProfileId, targetIdentityLinkId])

  const exposedState: NetCompromisedIdentitySystemState = !targetIdentityLinkId
    ? { status: 'unavailable' }
    : state.status === 'ready' && state.system.identityLinkId === targetIdentityLinkId
      ? state
      : state.status === 'loading' || state.status === 'error'
        ? state.identityLinkId === targetIdentityLinkId
          ? state
          : { status: 'loading', identityLinkId: targetIdentityLinkId }
        : { status: 'loading', identityLinkId: targetIdentityLinkId }

  return { state: exposedState }
}
