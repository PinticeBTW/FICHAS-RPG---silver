import { useEffect, useState } from 'react'

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
    : 'The GM target system profile could not be mounted.'
}

/**
 * Read-only mount for a server-confirmed inspect/compromised GM target.
 * This never exposes mutation operations: authorization for the target system
 * remains outside the effective runtime-identity contract.
 */
export function useNetGmTargetIdentitySystem(
  authenticatedProfileId: string | undefined,
  gmPersona: NetGmPersonaController,
  authoritativeIdentityLinkId?: string,
): NetCompromisedIdentitySystemController {
  const targetIdentityLinkId = authoritativeIdentityLinkId ?? (gmPersona.state.status === 'compromised'
    ? gmPersona.state.identity.identityLinkId
    : undefined)
  const [state, setState] = useState<NetCompromisedIdentitySystemState>({ status: 'unavailable' })

  useEffect(() => {
    let cancelled = false
    const expectedIdentityLinkId = targetIdentityLinkId
    const expectedProfileId = authenticatedProfileId
    const publish = (nextState: NetCompromisedIdentitySystemState) => {
      void Promise.resolve().then(() => {
        if (!cancelled) setState(nextState)
      })
    }

    if (!expectedIdentityLinkId || !expectedProfileId) {
      publish({ status: 'unavailable' })
      return () => { cancelled = true }
    }

    publish({ status: 'loading', identityLinkId: expectedIdentityLinkId })
    void fetchNetIdentitySystemForInspection(expectedIdentityLinkId)
      .then((system) => {
        if (cancelled) return
        publish({ status: 'ready', system })
      })
      .catch((error) => {
        if (cancelled) return
        publish({
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

export const useNetCompromisedIdentitySystem = useNetGmTargetIdentitySystem
