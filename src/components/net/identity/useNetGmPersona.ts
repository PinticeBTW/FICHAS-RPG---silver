import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Profile } from '../../../types/domain'
import {
  clearGmPersona,
  fetchGmPersona,
  setGmPersona,
} from '../../../lib/netGmPersonaService'
import type { NetIdentityLink } from '../../../lib/netIdentityService'
import { getNetIdentityLinkFromDirectoryCandidate } from '../../../lib/netGmIdentityDirectoryService'
import { resolveNetGmPersonaState } from './netGmPersonaResolver'
import { getNetIdentitySubjectId } from './netIdentitySelectors'
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

  useEffect(() => {
    profileIdRef.current = profileId ?? null
  }, [profileId])

  useEffect(() => {
    let cancelled = false
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
        if (cancelled || profileIdRef.current !== expectedProfileId) return
        setLoadState({
          status: 'ready',
          profileId: expectedProfileId,
          session: session?.gmProfileId === expectedProfileId ? session : null,
        })
      })
      .catch(() => {
        if (cancelled || profileIdRef.current !== expectedProfileId) return
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
    if (!expectedProfileId || profileRole !== 'gm') return
    try {
      const session = await fetchGmPersona()
      if (profileIdRef.current !== expectedProfileId) return
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
      void fetchGmPersona().then((session) => {
        if (cancelled || profileIdRef.current !== expectedProfileId) return
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

    changingRef.current = true
    setChanging(true)
    setChangeError(undefined)
    try {
      const session = await operation()
      if (profileIdRef.current !== expectedProfileId || session.gmProfileId !== expectedProfileId) {
        return false
      }
      setLoadState({
        status: 'ready',
        profileId: expectedProfileId,
        session,
      })
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
  const invalidSessionTarget = Boolean(
    profile?.role === 'gm'
    && session
    && session.mode !== 'none'
    && candidates.status === 'ready'
    && candidates.authenticatedProfileId === profile.id
    && !candidates.candidates.some((candidate) => (
      candidate.subject.kind !== 'character'
      && candidate.subject.kind === session.subject.kind
      && getNetIdentitySubjectId(candidate.subject) === getNetIdentitySubjectId(session.subject)
    )),
  )
  const invalidCompromisedTarget = Boolean(
    profile?.role === 'gm'
    && session?.mode === 'compromised-session'
    && candidates.status === 'ready'
    && candidates.authenticatedProfileId === profile.id
    && !identityLinks.some((link) => (
      link.identityKind === 'player'
      && link.playability === 'playable'
      && link.subject.kind === session.subject.kind
      && getNetIdentitySubjectId(link.subject) === getNetIdentitySubjectId(session.subject)
    )),
  )

  useEffect(() => {
    if (!invalidSessionTarget && !invalidCompromisedTarget) return
    void runChange(clearGmPersona)
  }, [invalidCompromisedTarget, invalidSessionTarget, runChange])

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
    clearPersona,
  }
}
