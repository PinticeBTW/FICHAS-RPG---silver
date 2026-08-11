import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Profile } from '../../../types/domain'
import {
  fetchActiveNetIdentity,
  fetchNetIdentityLinks,
  setActiveNetIdentity,
  type NetActiveIdentitySelection,
  type NetIdentityLink,
} from '../../../lib/netIdentityService'
import {
  resolveNetActiveIdentityCandidate,
  type NetActiveIdentityState,
} from './netActiveIdentity'
import { getNetIdentitySubjectId } from './netIdentitySelectors'
import type {
  NetPlayableIdentityCandidate,
  NetPlayableIdentityCandidateState,
} from './netIdentityTypes'

export interface NetPlayableLinkedIdentity {
  readonly link: NetIdentityLink
  readonly candidate: NetPlayableIdentityCandidate
}

export interface NetActiveIdentitySession {
  readonly activeIdentity: NetActiveIdentityState
  readonly activeIdentityLink?: NetIdentityLink
  readonly availablePlayableIdentities: readonly NetPlayableLinkedIdentity[]
  readonly switchingIdentityLinkId: string | null
  readonly switching: boolean
  readonly error?: string
  readonly refresh: () => Promise<void>
  readonly switchIdentity: (identityLinkId: string) => Promise<boolean>
}

type ServerIdentityState =
  | { readonly status: 'loading'; readonly authenticatedProfileId: string | null }
  | {
      readonly status: 'ready'
      readonly authenticatedProfileId: string
      readonly links: readonly NetIdentityLink[]
      readonly selection: NetActiveIdentitySelection | null
    }
  | { readonly status: 'error'; readonly authenticatedProfileId: string; readonly reason: string }

function subjectKey(candidate: { readonly subject: NetIdentityLink['subject'] }): string {
  return `${candidate.subject.kind}:${getNetIdentitySubjectId(candidate.subject)}`
}

function initialServerState(profile: Profile | null, authLoading: boolean): ServerIdentityState {
  if (authLoading) return { status: 'loading', authenticatedProfileId: profile?.id ?? null }
  if (!profile || profile.role === 'gm') {
    return { status: 'ready', authenticatedProfileId: profile?.id ?? '', links: [], selection: null }
  }
  return { status: 'loading', authenticatedProfileId: profile.id }
}

/**
 * Composes the already-authorised sheet candidates with identity links that
 * Supabase has explicitly approved. The client may request a switch, but the
 * RPC remains the sole authority that changes the selected identity.
 */
export function useNetActiveIdentitySession(
  profile: Profile | null,
  authLoading: boolean,
  candidates: NetPlayableIdentityCandidateState,
): NetActiveIdentitySession {
  const profileId = profile?.id
  const profileRole = profile?.role
  const [serverState, setServerState] = useState<ServerIdentityState>(
    () => initialServerState(profile, authLoading),
  )
  const [switchingIdentityLinkId, setSwitchingIdentityLinkId] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<string | undefined>()
  const currentProfileIdRef = useRef<string | null>(profile?.id ?? null)
  const automaticAttemptRef = useRef<string | null>(null)
  const switchingLinkRef = useRef<string | null>(null)

  useEffect(() => {
    currentProfileIdRef.current = profileId ?? null
  }, [profileId])

  useEffect(() => {
    let cancelled = false
    automaticAttemptRef.current = null
    switchingLinkRef.current = null
    setSwitchingIdentityLinkId(null)
    setSwitchError(undefined)

    if (authLoading) {
      setServerState({ status: 'loading', authenticatedProfileId: profileId ?? null })
      return () => { cancelled = true }
    }

    if (!profileId || profileRole === 'gm') {
      setServerState({
        status: 'ready',
        authenticatedProfileId: profileId ?? '',
        links: [],
        selection: null,
      })
      return () => { cancelled = true }
    }

    const expectedProfileId = profileId
    setServerState({ status: 'loading', authenticatedProfileId: expectedProfileId })
    void Promise.all([fetchNetIdentityLinks(), fetchActiveNetIdentity()])
      .then(([links, selection]) => {
        if (cancelled || currentProfileIdRef.current !== expectedProfileId) return
        setServerState({
          status: 'ready',
          authenticatedProfileId: expectedProfileId,
          links,
          selection: selection?.profileId === expectedProfileId ? selection : null,
        })
      })
      .catch(() => {
        if (cancelled || currentProfileIdRef.current !== expectedProfileId) return
        setServerState({
          status: 'error',
          authenticatedProfileId: expectedProfileId,
          reason: 'Authorised character selections could not be loaded.',
        })
      })

    return () => { cancelled = true }
  }, [authLoading, profileId, profileRole])

  const availablePlayableIdentities = useMemo<readonly NetPlayableLinkedIdentity[]>(() => {
    if (serverState.status !== 'ready' || candidates.status !== 'ready') return []
    if (serverState.authenticatedProfileId !== candidates.authenticatedProfileId) return []

    const candidatesBySubject = new Map(
      candidates.candidates.map((candidate) => [subjectKey(candidate), candidate]),
    )

    return serverState.links.flatMap((link) => {
      if (link.identityKind !== 'player' || link.playability !== 'playable') return []
      const candidate = candidatesBySubject.get(subjectKey(link))
      return candidate ? [{ link, candidate: { ...candidate, playability: 'confirmed' } }] : []
    })
  }, [candidates, serverState])

  const activeIdentityLink = useMemo(() => {
    if (serverState.status !== 'ready' || !serverState.selection) return undefined
    return availablePlayableIdentities.find(
      ({ link }) => link.id === serverState.selection?.identityLinkId,
    )?.link
  }, [availablePlayableIdentities, serverState])

  const switchIdentity = useCallback(async (identityLinkId: string): Promise<boolean> => {
    const expectedProfileId = currentProfileIdRef.current
    if (!expectedProfileId || profile?.role !== 'player') return false
    if (switchingLinkRef.current) return false

    const selectable = availablePlayableIdentities.some(({ link }) => link.id === identityLinkId)
    if (!selectable) {
      setSwitchError('That character is no longer authorised for this account.')
      return false
    }

    switchingLinkRef.current = identityLinkId
    setSwitchingIdentityLinkId(identityLinkId)
    setSwitchError(undefined)

    try {
      const selection = await setActiveNetIdentity(identityLinkId)
      if (currentProfileIdRef.current !== expectedProfileId || selection.profileId !== expectedProfileId) {
        return false
      }

      setServerState((current) => current.status === 'ready'
        && current.authenticatedProfileId === expectedProfileId
        ? { ...current, selection }
        : current)
      return true
    } catch {
      if (currentProfileIdRef.current === expectedProfileId) {
        setSwitchError('THE NET could not change the active character. Keep the current identity and try again.')
      }
      return false
    } finally {
      if (currentProfileIdRef.current === expectedProfileId) {
        switchingLinkRef.current = null
        setSwitchingIdentityLinkId(null)
      }
    }
  }, [availablePlayableIdentities, profile?.role])

  const refresh = useCallback(async (): Promise<void> => {
    const expectedProfileId = currentProfileIdRef.current
    if (!expectedProfileId || profile?.role !== 'player') return
    try {
      const [links, selection] = await Promise.all([
        fetchNetIdentityLinks(),
        fetchActiveNetIdentity(),
      ])
      if (currentProfileIdRef.current !== expectedProfileId) return
      setServerState({
        status: 'ready',
        authenticatedProfileId: expectedProfileId,
        links,
        selection: selection?.profileId === expectedProfileId ? selection : null,
      })
    } catch {
      // Preserve the last confirmed identity. The failed PULSE request already
      // prevented any wrong-character server mutation.
    }
  }, [profile?.role])

  const activeIdentity = useMemo<NetActiveIdentityState>(() => {
    if (authLoading || candidates.status === 'loading' || serverState.status === 'loading') {
      return { status: 'loading' }
    }
    if (!profile) return { status: 'no-identity', reason: 'No authenticated profile is available.' }
    if (profile.role === 'gm') return { status: 'gm-no-persona', authenticatedProfileId: profile.id }
    if (candidates.status === 'error') return { status: 'error', reason: candidates.reason }
    if (serverState.status === 'error') return { status: 'error', reason: serverState.reason }

    const selected = availablePlayableIdentities.find(
      ({ link }) => link.id === serverState.selection?.identityLinkId,
    )
    if (selected) {
      return resolveNetActiveIdentityCandidate({
        profile,
        candidate: selected.candidate,
        source: 'explicit',
        identityLinkId: selected.link.id,
        ...(selected.link.entityId ? { entityId: selected.link.entityId } : {}),
        identityKind: selected.link.identityKind,
      })
    }

    if (availablePlayableIdentities.length === 1) {
      if (switchError) {
        return { status: 'no-identity', reason: switchError }
      }
      return { status: 'loading' }
    }
    if (availablePlayableIdentities.length > 1) {
      return {
        status: 'selection-required',
        authenticatedProfileId: profile.id,
        reason: 'Choose a server-authorised character before using personal NET accounts.',
      }
    }
    return {
      status: 'no-identity',
      reason: 'No server-authorised playable character is available for this account.',
    }
  }, [authLoading, availablePlayableIdentities, candidates, profile, serverState, switchError])

  useEffect(() => {
    if (
      !profile
      || profile.role !== 'player'
      || serverState.status !== 'ready'
      || availablePlayableIdentities.length !== 1
      || activeIdentityLink
      || switchingIdentityLinkId
    ) return

    const onlyLinkId = availablePlayableIdentities[0].link.id
    const attemptKey = `${profile.id}:${onlyLinkId}`
    if (automaticAttemptRef.current === attemptKey) return
    automaticAttemptRef.current = attemptKey
    void switchIdentity(onlyLinkId)
  }, [activeIdentityLink, availablePlayableIdentities, profile, serverState.status, switchIdentity, switchingIdentityLinkId])

  return {
    activeIdentity,
    ...(activeIdentityLink ? { activeIdentityLink } : {}),
    availablePlayableIdentities,
    switchingIdentityLinkId,
    switching: switchingIdentityLinkId !== null,
    refresh,
    ...(switchError ? { error: switchError } : {}),
    switchIdentity,
  }
}
