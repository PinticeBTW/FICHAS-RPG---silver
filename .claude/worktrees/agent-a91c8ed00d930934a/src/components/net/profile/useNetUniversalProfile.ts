import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  fetchUniversalNetProfile,
  saveUniversalNetProfile,
} from '../../../lib/netUniversalProfileService'
import type { NetActiveIdentityState } from '../identity/netActiveIdentity'
import type { NetPlayableLinkedIdentity } from '../identity/useNetActiveIdentitySession'
import { resolveUniversalNetProfile } from './netUniversalProfileResolver'
import type {
  NetUniversalProfileController,
  NetUniversalProfileState,
} from './netUniversalProfileTypes'

function inactiveState(activeIdentity: NetActiveIdentityState): NetUniversalProfileState {
  if (activeIdentity.status === 'gm-no-persona') {
    return { status: 'no-active-identity', reason: 'GM Session has no active persona.' }
  }
  if (activeIdentity.status === 'selection-required') {
    return { status: 'no-active-identity', reason: 'Select a character before editing a NET Profile.' }
  }
  return { status: 'no-active-identity', reason: 'No active fictional identity is available.' }
}

/**
 * Server-backed profile state is deliberately keyed to the active identity
 * link. It clears synchronously at identity changes and ignores stale reads.
 */
export function useNetUniversalProfile(
  activeIdentity: NetActiveIdentityState,
  activeIdentityLink: NetPlayableLinkedIdentity['link'] | undefined,
  availablePlayableIdentities: readonly NetPlayableLinkedIdentity[],
): NetUniversalProfileController {
  const activeLinkedIdentity = activeIdentityLink
    ? availablePlayableIdentities.find(({ link }) => link.id === activeIdentityLink.id)
    : undefined
  const activeLinkId = activeIdentity.status === 'ready' ? activeIdentityLink?.id : undefined
  const [state, setState] = useState<NetUniversalProfileState>(() => (
    activeLinkId ? { status: 'loading', identityLinkId: activeLinkId } : inactiveState(activeIdentity)
  ))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>()
  const activeLinkIdRef = useRef<string | undefined>(activeLinkId)

  useEffect(() => {
    activeLinkIdRef.current = activeLinkId
    setSaving(false)
    setSaveError(undefined)

    if (activeIdentity.status !== 'ready' || !activeLinkId || !activeLinkedIdentity) {
      setState(inactiveState(activeIdentity))
      return undefined
    }

    let cancelled = false
    setState({ status: 'loading', identityLinkId: activeLinkId })

    void fetchUniversalNetProfile(activeLinkId)
      .then((profile) => {
        if (cancelled || activeLinkIdRef.current !== activeLinkId) return
        setState({
          status: 'ready',
          identityLinkId: activeLinkId,
          profile,
          resolved: resolveUniversalNetProfile({
            activeIdentity,
            identityLinkId: activeLinkId,
            candidate: activeLinkedIdentity.candidate,
            profile,
          }),
        })
      })
      .catch(() => {
        if (cancelled || activeLinkIdRef.current !== activeLinkId) return
        setState({
          status: 'error',
          identityLinkId: activeLinkId,
          reason: 'Universal NET Profile could not be loaded for this character.',
        })
      })

    return () => { cancelled = true }
  }, [activeIdentity, activeLinkId, activeLinkedIdentity])

  const save = useCallback(async (input: {
    readonly displayNameOverride?: string
    readonly bio?: string
    readonly status?: string
    readonly avatarUrlOverride?: string
  }): Promise<boolean> => {
    const expectedLinkId = activeLinkIdRef.current
    if (!expectedLinkId || activeIdentity.status !== 'ready' || !activeLinkedIdentity) return false

    setSaving(true)
    setSaveError(undefined)
    try {
      const profile = await saveUniversalNetProfile({ identityLinkId: expectedLinkId, ...input })
      if (activeLinkIdRef.current !== expectedLinkId) return false

      setState({
        status: 'ready',
        identityLinkId: expectedLinkId,
        profile,
        resolved: resolveUniversalNetProfile({
          activeIdentity,
          identityLinkId: expectedLinkId,
          candidate: activeLinkedIdentity.candidate,
          profile,
        }),
      })
      return true
    } catch {
      if (activeLinkIdRef.current === expectedLinkId) {
        setSaveError('THE NET could not save this profile. Your changes are still available to retry.')
      }
      return false
    } finally {
      if (activeLinkIdRef.current === expectedLinkId) setSaving(false)
    }
  }, [activeIdentity, activeLinkedIdentity])

  const visibleState = useMemo<NetUniversalProfileState>(() => {
    if (activeIdentity.status !== 'ready' || !activeLinkId || !activeLinkedIdentity) {
      return inactiveState(activeIdentity)
    }
    if (
      (state.status === 'ready' || state.status === 'error')
      && state.identityLinkId !== activeLinkId
    ) {
      return { status: 'loading', identityLinkId: activeLinkId }
    }
    if (state.status === 'loading' && state.identityLinkId !== activeLinkId) {
      return { status: 'loading', identityLinkId: activeLinkId }
    }
    return state
  }, [activeIdentity, activeLinkId, activeLinkedIdentity, state])

  return useMemo(
    () => ({ state: visibleState, saving, ...(saveError ? { error: saveError } : {}), save }),
    [save, saveError, saving, visibleState],
  )
}
