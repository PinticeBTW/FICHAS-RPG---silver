import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Profile } from '../../../types/domain'
import {
  clearGmPersona,
  fetchGmPersona,
  notifyNetGmControlChanged,
  setGmPersona,
} from '../../../lib/netGmPersonaService'
import type { NetIdentityLink } from '../../../lib/netIdentityService'
import { getNetIdentityLinkFromDirectoryCandidate } from '../../../lib/netGmIdentityDirectoryService'
import { resolveNetGmPersonaState } from './netGmPersonaResolver'
import type {
  NetGmPersonaSession,
  NetGmPersonaState,
  NetGmPersonaSubject,
  NetSelectableGmPersonaMode,
} from './netGmPersonaTypes'
import type { NetPlayableIdentityCandidateState } from './netIdentityTypes'

export interface NetGmPersonaController {
  readonly state: NetGmPersonaState
  readonly session: NetGmPersonaSession | null
  /** Server-authoritative semantic classification for the visible subjects. */
  readonly identityLinks: readonly NetIdentityLink[]
  readonly changing: boolean
  readonly error?: string
  readonly refresh: () => Promise<void>
  readonly setPersona: (
    subject: NetGmPersonaSubject,
    mode: NetSelectableGmPersonaMode,
  ) => Promise<boolean>
  readonly controlIdentity: (subject: NetGmPersonaSubject) => Promise<boolean>
  readonly clearPersona: () => Promise<boolean>
}

type SessionLoadState =
  | { readonly status: 'loading'; readonly profileId: string | null }
  | {
      readonly status: 'ready'
      readonly profileId: string
      readonly session: NetGmPersonaSession | null
    }
  | { readonly status: 'error'; readonly profileId: string; readonly reason: string }

/**
 * Loads and changes only the server-backed GM context. It never mutates the
 * authenticated session or converts a persona into client-side authorization.
 */
export function useNetGmPersona(
  profile: Profile | null,
  authLoading: boolean,
  candidates: NetPlayableIdentityCandidateState,
): NetGmPersonaController {
  const profileId = profile?.id
  const profileRole = profile?.role
  const [loadState, setLoadState] = useState<SessionLoadState>({
    status: 'loading',
    profileId: profile?.id ?? null,
  })
  const [changing, setChanging] = useState(false)
  const [changeError, setChangeError] = useState<string | undefined>()
  const profileIdRef = useRef<string | null>(profile?.id ?? null)
  const changingRef = useRef(false)
  const requestGenerationRef = useRef(0)

  useEffect(() => {
    profileIdRef.current = profileId ?? null
  }, [profileId])

  useEffect(() => {
    let cancelled = false
    const requestGeneration = ++requestGenerationRef.current
    changingRef.current = false
    setChanging(false)
    setChangeError(undefined)

    if (authLoading) {
      setLoadState({ status: 'loading', profileId: profileId ?? null })
      return () => { cancelled = true }
    }

    if (!profileId || profileRole !== 'gm') {
      setLoadState({ status: 'ready', profileId: profileId ?? '', session: null })
      return () => { cancelled = true }
    }

    const expectedProfileId = profileId
    setLoadState({ status: 'loading', profileId: expectedProfileId })
    void fetchGmPersona()
      .then((session) => {
        if (
          cancelled
          || profileIdRef.current !== expectedProfileId
          || requestGeneration !== requestGenerationRef.current
        ) return
        setLoadState({
          status: 'ready',
          profileId: expectedProfileId,
          session: session?.gmProfileId === expectedProfileId ? session : null,
        })
      })
      .catch(() => {
        if (
          cancelled
          || profileIdRef.current !== expectedProfileId
          || requestGeneration !== requestGenerationRef.current
        ) return
        setLoadState({
          status: 'error',
          profileId: expectedProfileId,
          reason: 'The GM persona session could not be loaded.',
        })
      })

    return () => { cancelled = true }
  }, [authLoading, profileId, profileRole])

  const refresh = useCallback(async (): Promise<void> => {
    const expectedProfileId = profileIdRef.current
    if (!expectedProfileId || profileRole !== 'gm' || changingRef.current) return
    const requestGeneration = ++requestGenerationRef.current
    try {
      const session = await fetchGmPersona()
      if (
        profileIdRef.current !== expectedProfileId
        || requestGeneration !== requestGenerationRef.current
      ) return
      setLoadState({
        status: 'ready',
        profileId: expectedProfileId,
        session: session?.gmProfileId === expectedProfileId ? session : null,
      })
    } catch {
      // Context mismatch recovery retains the last confirmed presentation.
      // The rejected server action is already fail-closed.
    }
  }, [profileRole])

  useEffect(() => {
    if (authLoading || !profileId || profileRole !== 'gm') return undefined
    let cancelled = false
    const expectedProfileId = profileId
    const refreshPersona = () => {
      if (changingRef.current) return
      const requestGeneration = ++requestGenerationRef.current
      void fetchGmPersona().then((session) => {
        if (
          cancelled
          || profileIdRef.current !== expectedProfileId
          || requestGeneration !== requestGenerationRef.current
        ) return
        setLoadState({
          status: 'ready',
          profileId: expectedProfileId,
          session: session?.gmProfileId === expectedProfileId ? session : null,
        })
      }).catch(() => {
        // The initial load owns visible errors. A failed focus revalidation
        // keeps the last server-confirmed context instead of inventing state.
      })
    }

    window.addEventListener('focus', refreshPersona)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refreshPersona)
    }
  }, [authLoading, profileId, profileRole])

  const runChange = useCallback(async (
    operation: () => Promise<NetGmPersonaSession>,
  ): Promise<boolean> => {
    const expectedProfileId = profileIdRef.current
    if (!expectedProfileId || profileRole !== 'gm' || changingRef.current) return false

    // Invalidate mount/focus reads that began before this authoritative
    // mutation. Their response must never replace the RPC result afterwards.
    const mutationGeneration = ++requestGenerationRef.current
    changingRef.current = true
    setChanging(true)
    setChangeError(undefined)
    try {
      const session = await operation()
      if (
        profileIdRef.current !== expectedProfileId
        || mutationGeneration !== requestGenerationRef.current
        || session.gmProfileId !== expectedProfileId
      ) {
        return false
      }
      setLoadState({
        status: 'ready',
        profileId: expectedProfileId,
        session,
      })
      // Every authoritative control mutation invalidates the routing snapshot.
      // The event carries no authority; the routing RPC decides whether the
      // effective shell changes or remains the same.
      notifyNetGmControlChanged()
      return true
    } catch (error) {
      if (profileIdRef.current === expectedProfileId) {
        setChangeError(error instanceof Error
          ? error.message
          : 'THE NET could not change the GM persona context.')
      }
      return false
    } finally {
      if (profileIdRef.current === expectedProfileId) {
        changingRef.current = false
        setChanging(false)
      }
    }
  }, [profileRole])

  const setPersona = useCallback((
    subject: NetGmPersonaSubject,
    mode: NetSelectableGmPersonaMode,
  ) => runChange(() => setGmPersona(subject, mode)), [runChange])

  const controlIdentity = useCallback(
    (subject: NetGmPersonaSubject) => runChange(() => setGmPersona(subject, 'take-control')),
    [runChange],
  )

  const clearPersona = useCallback(
    () => runChange(clearGmPersona),
    [runChange],
  )

  const session = loadState.status === 'ready' ? loadState.session : null
  const identityLinks = useMemo<readonly NetIdentityLink[]>(() => {
    if (
      profile?.role !== 'gm'
      || candidates.status !== 'ready'
      || candidates.authenticatedProfileId !== profile.id
    ) return []
    return candidates.candidates.flatMap((candidate) => {
      const link = getNetIdentityLinkFromDirectoryCandidate(candidate)
      return link ? [link] : []
    })
  }, [candidates, profile?.id, profile?.role])

  // The compact GM directory is presentation data and may be refreshing or
  // temporarily incomplete during an OS shell transition. It must never clear
  // a server-authoritative persona session. The persona RPC validates every
  // target on entry, and database triggers clear sessions whose source record
  // is actually deleted.
  const state = useMemo<NetGmPersonaState>(() => {
    if (loadState.status === 'loading') return { status: 'loading' }
    if (loadState.status === 'error') return { status: 'error', reason: loadState.reason }
    if (!profile) return resolveNetGmPersonaState({ profile, authLoading, session, candidates, identityLinks })
    if (loadState.profileId !== profile.id) return { status: 'loading' }
    return resolveNetGmPersonaState({ profile, authLoading, session, candidates, identityLinks })
  }, [authLoading, candidates, identityLinks, loadState, profile, session])

  return {
    state,
    session,
    identityLinks,
    changing,
    refresh,
    ...(changeError ? { error: changeError } : {}),
    setPersona,
    controlIdentity,
    clearPersona,
  }
}
