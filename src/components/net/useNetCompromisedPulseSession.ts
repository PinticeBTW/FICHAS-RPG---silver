import { useEffect, useMemo, useState } from 'react'

import { fetchNetAppAccountsForInspection } from '../../lib/netAppAccountService'
import {
  getNetAppAccountAvatar,
  getNetAppAccountDisplayHandle,
} from './accounts/netAppAccountSelectors'
import type { NetAppAccount } from './accounts/netAppAccountTypes'
import type { NetGmPersonaController } from './identity/useNetGmPersona'
import { getNetIdentitySubjectId } from './identity/netIdentitySelectors'
import type { NetResolvedIdentity } from './identity/netIdentityTypes'
import type { PulseCurrentIdentity } from './pulseCurrentIdentity'

export type NetCompromisedPulseSession =
  | { readonly status: 'inactive' }
  | { readonly status: 'loading'; readonly targetName: string }
  | {
      readonly status: 'ready'
      readonly account: NetAppAccount
      readonly identity: PulseCurrentIdentity
      readonly sessionGeneration: string
    }
  | {
      readonly status: 'unavailable'
      readonly targetName: string
      readonly reason: string
      readonly code: 'missing-link' | 'no-account' | 'restricted' | 'load-error'
    }

function subjectsMatch(
  left: NetResolvedIdentity['subject'],
  right: NetResolvedIdentity['subject'],
): boolean {
  return left.kind === right.kind
    && getNetIdentitySubjectId(left) === getNetIdentitySubjectId(right)
}

function resolvePulsePresentation(account: NetAppAccount, identity: NetResolvedIdentity): PulseCurrentIdentity {
  const avatarUrl = getNetAppAccountAvatar(account, identity)
  const displayHandle = getNetAppAccountDisplayHandle(account)
  return {
    accountId: account.id,
    displayName: displayHandle,
    displayHandle,
    ...(avatarUrl ? { avatarUrl } : {}),
    identity,
  }
}

/**
 * Reads only the PULSE account selected by the GM's authoritative compromised
 * persona session. This is presentation state; the write RPC derives the same
 * target again from auth.uid() and never accepts this account id as authority.
 */
export function useNetCompromisedPulseSession(
  authenticatedProfileId: string | undefined,
  controller: NetGmPersonaController,
): NetCompromisedPulseSession {
  const personaIdentity = controller.state.status === 'compromised'
    ? controller.state.identity
    : undefined
  const identityLink = personaIdentity
    ? controller.identityLinks.find((link) => (
        link.identityKind === 'player'
        && link.playability === 'playable'
        && subjectsMatch(link.subject, personaIdentity.subject)
      ))
    : undefined
  const identityLinkId = identityLink?.id
  const loadKey = authenticatedProfileId && personaIdentity && identityLinkId
    && controller.session?.mode === 'compromised-session'
    ? `${authenticatedProfileId}:${identityLinkId}:${controller.session.sessionGeneration}`
    : null
  const [state, setState] = useState<NetCompromisedPulseSession>({ status: 'inactive' })
  const isCompromised = controller.state.status === 'compromised'
  const identityPresentationKey = personaIdentity
    ? `${personaIdentity.identityLinkId ?? ''}:${personaIdentity.displayName}:${personaIdentity.avatarUrl ?? ''}`
    : ''

  useEffect(() => {
    let cancelled = false
    const publishState = (nextState: NetCompromisedPulseSession) => {
      void Promise.resolve().then(() => {
        if (!cancelled) setState(nextState)
      })
    }
    if (!authenticatedProfileId || !isCompromised) {
      publishState({ status: 'inactive' })
      return () => { cancelled = true }
    }

    const targetIdentity = personaIdentity
    if (!targetIdentity || !identityLinkId || !loadKey) {
      publishState({
        status: 'unavailable',
        targetName: targetIdentity?.displayName ?? 'COMPROMISED TARGET',
        code: 'missing-link',
        reason: 'This player identity no longer has an authoritative playable link.',
      })
      return () => { cancelled = true }
    }

    const expectedSessionGeneration = controller.session?.mode === 'compromised-session'
      ? controller.session.sessionGeneration
      : null
    if (!expectedSessionGeneration) {
      publishState({
        status: 'unavailable',
        targetName: targetIdentity.displayName,
        code: 'load-error',
        reason: 'The compromised session generation is unavailable.',
      })
      return () => { cancelled = true }
    }
    publishState({ status: 'loading', targetName: targetIdentity.displayName })

    const resolvedIdentity: NetResolvedIdentity = {
      ...targetIdentity,
      identityLinkId,
      identityKind: 'player',
    }

    void fetchNetAppAccountsForInspection(identityLinkId)
      .then((accounts) => {
        if (cancelled) return
        const account = accounts.find((candidate) => candidate.appId === 'pulse') ?? null
        if (!account) {
          setState({
            status: 'unavailable',
            targetName: resolvedIdentity.displayName,
            code: 'no-account',
            reason: 'TARGET_HAS_NO_PULSE_ACCOUNT',
          })
          return
        }
        if (account.status !== 'active') {
          setState({
            status: 'unavailable',
            targetName: resolvedIdentity.displayName,
            code: 'restricted',
            reason: `The target PULSE account is ${account.status}.`,
          })
          return
        }

        setState({
          status: 'ready',
          account,
          identity: resolvePulsePresentation(account, resolvedIdentity),
          sessionGeneration: expectedSessionGeneration,
        })
      })
      .catch(() => {
        if (cancelled) return
        setState({
          status: 'unavailable',
          targetName: targetIdentity.displayName,
          code: 'load-error',
          reason: 'The target PULSE account could not be resolved.',
        })
      })

    return () => { cancelled = true }
  }, [authenticatedProfileId, controller.session, identityLinkId, isCompromised, loadKey, personaIdentity])

  // Hydration can refine a target from a safe placeholder to its sheet name.
  // Preserve the same account/session and update presentation only.
  useEffect(() => {
    if (!personaIdentity || !identityLinkId || !isCompromised) return
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      setState((current) => {
        if (current.status !== 'ready') return current
        const identity: NetResolvedIdentity = {
          ...personaIdentity,
          identityLinkId,
          identityKind: 'player',
        }
        const nextIdentity = resolvePulsePresentation(current.account, identity)
        return nextIdentity.displayName === current.identity.displayName
          && nextIdentity.avatarUrl === current.identity.avatarUrl
          && nextIdentity.identity.identityLinkId === current.identity.identity.identityLinkId
          ? current
          : { ...current, identity: nextIdentity }
      })
    })
    return () => { cancelled = true }
  }, [identityLinkId, identityPresentationKey, isCompromised, personaIdentity])

  return useMemo(() => state, [state])
}
