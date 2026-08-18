import { KeyRound, Network, RefreshCw, UserRoundCheck } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'

import { AltaraOsGateway } from '../components/net/AltaraOsGateway'
import { VeilEarlyAccessGate } from '../components/net/VeilEarlyAccessGate'
import { useNetActiveIdentitySession } from '../components/net/identity/useNetActiveIdentitySession'
import { useNetPlayableIdentityCandidates } from '../components/net/identity/useNetPlayableIdentityCandidates'
import { useNetSystemHackingRuntime } from '../components/net/system/useNetSystemHackingRuntime'
import { useAuth } from '../hooks/useAuth'
import { NET_ACTIVE_IDENTITY_CHANGED_EVENT } from '../lib/netIdentityService'
import { NET_GM_CONTROL_CHANGED_EVENT } from '../lib/netGmPersonaService'
import {
  NET_GM_WORKSPACE_CHANGED_EVENT,
  isNetGmWorkspaceStorageEvent,
  readNetGmWorkspace,
} from '../lib/netGmWorkspaceStore'
import {
  NET_OS_AUTHORITY_CHANGED_EVENT,
  fetchNetCurrentOsSession,
  resolveNetEffectiveOs,
  type NetCurrentOsSession,
  type NetResolvedOsSession,
} from '../lib/netOsService'
import type { NetOsId } from '../lib/netOsTypes'
import type { Profile } from '../types/domain'
import '../styles/netOsEntry.css'

const NetHubPage = lazy(() => import('./NetHubPage').then((module) => ({
  default: module.NetHubPage,
})))

type ResolutionState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'transitioning'
      readonly profileId: string
      readonly requestGeneration: number
      readonly session: NetResolvedOsSession
    }
  | { readonly status: 'ready'; readonly profileId: string; readonly session: NetResolvedOsSession }
  | { readonly status: 'error'; readonly profileId: string; readonly reason: string }

function isSameResolvedOsSession(
  current: NetResolvedOsSession,
  next: NetResolvedOsSession,
): boolean {
  return current.actorMode === next.actorMode
    && current.controlMode === next.controlMode
    && current.identityLinkId === next.identityLinkId
    && current.primaryOsId === next.primaryOsId
    && current.effectiveOsId === next.effectiveOsId
}

function resolveEffectiveOsForProfile(
  session: NetCurrentOsSession,
  profileId: string,
): NetOsId | undefined {
  const gmWorkspaceOsId = session.actorMode === 'gm-system'
    ? readNetGmWorkspace(profileId)
    : undefined
  return resolveNetEffectiveOs(session, gmWorkspaceOsId)
}

function IdentitySelectionGate({
  profile,
  onCancel,
}: {
  readonly profile: Profile
  readonly onCancel?: () => void
}) {
  const candidates = useNetPlayableIdentityCandidates(profile, false)
  const session = useNetActiveIdentitySession(profile, false, candidates)

  const unavailable = candidates.status === 'error'
    ? candidates.reason
    : session.activeIdentity.status === 'error'
      || session.activeIdentity.status === 'no-identity'
      ? session.activeIdentity.reason
      : null

  return (
    <main className="net-os-entry" data-state="selection">
      <section className="net-os-entry__panel" aria-labelledby="net-os-selection-title">
        <div className="net-os-entry__icon"><UserRoundCheck size={21} aria-hidden="true" /></div>
        <p>THE NET // IDENTITY ROUTER</p>
        <h1 id="net-os-selection-title">SELECT ACTIVE CHARACTER</h1>
        <span>The authoritative identity selection determines which operating environment can open.</span>

        {unavailable ? <p className="net-os-entry__error" role="alert">{unavailable}</p> : null}
        {candidates.status === 'loading' || session.activeIdentity.status === 'loading' ? (
          <p className="net-os-entry__status" role="status">RESOLVING AUTHORISED IDENTITIES…</p>
        ) : null}

        <div className="net-os-entry__identities">
          {session.availablePlayableIdentities.map(({ link, candidate }) => (
            <button
              key={link.id}
              type="button"
              disabled={session.switching}
              onClick={() => { void session.switchIdentity(link.id) }}
            >
              <strong>{candidate.displayName}</strong>
              <span>{candidate.city ?? candidate.sourceKind.replace('-', ' ')}</span>
              <small>{session.switchingIdentityLinkId === link.id ? 'AUTHORIZING…' : 'OPEN THE NET'}</small>
            </button>
          ))}
        </div>

        {candidates.status === 'error' && candidates.retry ? (
          <button type="button" className="net-os-entry__retry" onClick={candidates.retry}>
            <RefreshCw size={14} aria-hidden="true" /> RETRY IDENTITY DIRECTORY
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" className="net-os-entry__cancel" onClick={onCancel}>CANCEL</button>
        ) : null}
      </section>
    </main>
  )
}

function ResolutionScreen({ error, onRetry }: { readonly error?: string; readonly onRetry: () => void }) {
  return (
    <main className="net-os-entry" data-state={error ? 'error' : 'loading'}>
      <section className="net-os-entry__panel" aria-live="polite">
        <div className="net-os-entry__icon">{error ? <KeyRound size={21} /> : <Network size={21} />}</div>
        <p>THE NET // SYSTEM AUTHORITY</p>
        <h1>{error ? 'OPERATING SYSTEM UNAVAILABLE' : 'RESOLVING SYSTEM ENVIRONMENT'}</h1>
        <span>{error ?? 'Resolving authenticated role, GM control context, and authoritative operating-system assignment.'}</span>
        {error ? (
          <button type="button" className="net-os-entry__retry" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" /> RETRY AUTHORITY CHECK
          </button>
        ) : <i className="net-os-entry__progress" aria-hidden="true" />}
      </section>
    </main>
  )
}

export function NetOsEntryPage() {
  const { profile, loading: authLoading } = useAuth()
  const profileId = profile?.id
  const hacking = useNetSystemHackingRuntime(profileId)
  const [requestVersion, setRequestVersion] = useState(0)
  const [state, setState] = useState<ResolutionState>({ status: 'loading' })
  const [showIdentityPicker, setShowIdentityPicker] = useState(false)
  const resolutionGenerationRef = useRef(0)

  const resolve = useCallback(() => {
    resolutionGenerationRef.current += 1
    setShowIdentityPicker(false)
    setState({ status: 'loading' })
    setRequestVersion((version) => version + 1)
  }, [])

  const reconcileAuthoritativeSession = useCallback(() => {
    if (authLoading || !profileId) return
    const expectedProfileId = profileId
    const requestGeneration = ++resolutionGenerationRef.current

    void fetchNetCurrentOsSession()
      .then((session) => {
        if (requestGeneration !== resolutionGenerationRef.current) return
        const effectiveOsId = resolveEffectiveOsForProfile(session, profileId) ?? 'veil'
        const nextSession: NetResolvedOsSession = { ...session, effectiveOsId }
        setState((current) => {
          if (
            current.status === 'ready'
            && current.profileId === profileId
            && isSameResolvedOsSession(current.session, nextSession)
          ) {
            return current
          }
          if (
            current.status === 'ready'
            && current.profileId === profileId
            && current.session.effectiveOsId !== nextSession.effectiveOsId
          ) {
            return {
              status: 'transitioning',
              profileId,
              requestGeneration,
              session: nextSession,
            }
          }
          return { status: 'ready', profileId, session: nextSession }
        })
      })
      .catch((error: unknown) => {
        if (requestGeneration !== resolutionGenerationRef.current) return
        setState({
          status: 'error',
          profileId: expectedProfileId,
          reason: error instanceof Error
            ? error.message
            : 'Operating-system authority could not be revalidated.',
        })
      })
  }, [authLoading, profileId])

  useEffect(() => {
    if (state.status !== 'transitioning') return
    if (state.requestGeneration !== resolutionGenerationRef.current) return
    const frame = window.requestAnimationFrame(() => {
      if (state.requestGeneration !== resolutionGenerationRef.current) return
      setState((current) => current === state
        ? { status: 'ready', profileId: state.profileId, session: state.session }
        : current)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [state])

  useEffect(() => {
    window.addEventListener(NET_ACTIVE_IDENTITY_CHANGED_EVENT, resolve)
    window.addEventListener(NET_GM_CONTROL_CHANGED_EVENT, resolve)
    window.addEventListener(NET_GM_WORKSPACE_CHANGED_EVENT, resolve)
    window.addEventListener(NET_OS_AUTHORITY_CHANGED_EVENT, resolve)
    const handleStorage = (event: StorageEvent) => {
      if (profileId && isNetGmWorkspaceStorageEvent(event, profileId)) resolve()
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') reconcileAuthoritativeSession()
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener('focus', reconcileAuthoritativeSession)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener(NET_ACTIVE_IDENTITY_CHANGED_EVENT, resolve)
      window.removeEventListener(NET_GM_CONTROL_CHANGED_EVENT, resolve)
      window.removeEventListener(NET_GM_WORKSPACE_CHANGED_EVENT, resolve)
      window.removeEventListener(NET_OS_AUTHORITY_CHANGED_EVENT, resolve)
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('focus', reconcileAuthoritativeSession)
      document.removeEventListener('visibilitychange', handleVisibility)
      resolutionGenerationRef.current += 1
    }
  }, [profileId, reconcileAuthoritativeSession, resolve])

  useEffect(() => {
    if (authLoading || !profileId) return undefined

    let cancelled = false
    const requestGeneration = ++resolutionGenerationRef.current
    void fetchNetCurrentOsSession()
      .then((session) => {
        if (cancelled || requestGeneration !== resolutionGenerationRef.current) return
        const effectiveOsId = resolveEffectiveOsForProfile(session, profileId)
        if (!effectiveOsId) {
          setState({ status: 'ready', profileId, session: { ...session, effectiveOsId: 'veil' } })
          return
        }
        setState({ status: 'ready', profileId, session: { ...session, effectiveOsId } })
      })
      .catch((error: unknown) => {
        if (cancelled || requestGeneration !== resolutionGenerationRef.current) return
        setState({
          status: 'error',
          profileId,
          reason: error instanceof Error ? error.message : 'Operating-system authority could not be resolved.',
        })
      })
    return () => {
      cancelled = true
      if (resolutionGenerationRef.current === requestGeneration) {
        resolutionGenerationRef.current += 1
      }
    }
  }, [authLoading, profileId, requestVersion])

  if (
    authLoading
    || state.status === 'loading'
    || state.status === 'transitioning'
    || state.profileId !== profileId
  ) {
    return <ResolutionScreen onRetry={resolve} />
  }
  if (state.status === 'error') return <ResolutionScreen error={state.reason} onRetry={resolve} />
  if (!profile) return <ResolutionScreen error="An authenticated profile is required." onRetry={resolve} />

  if (showIdentityPicker && profile.role === 'player') {
    return <IdentitySelectionGate profile={profile} onCancel={() => setShowIdentityPicker(false)} />
  }

  if (state.session.actorMode === 'player' && !state.session.primaryOsId) {
    return <IdentitySelectionGate profile={profile} />
  }

  // Full runtime-takeover parity: while a player's own hacking session is
  // both active and "entered", the OS actually mounted follows the
  // hacking TARGET's operating system, not the actor's own home OS --
  // never overridden for GM/TAKE CONTROL sessions, which already have
  // their own, unrelated OS routing. osSession itself is passed through
  // completely unchanged below (never Adrian's selected character, never
  // a GM persona session): AltaraOsGateway / NetHubPage each independently
  // resolve the same hacking projection internally to decide whose data
  // to render inside whichever shell this selects.
  const mountedOsId = state.session.actorMode === 'player' && hacking.mounted && hacking.session?.active
    ? hacking.session.targetOsId ?? state.session.effectiveOsId
    : state.session.effectiveOsId

  if (mountedOsId === 'altara') {
    return (
      <AltaraOsGateway
        osSession={state.session}
        resolvedIdentityLinkId={state.session.identityLinkId}
        onChangeIdentity={() => setShowIdentityPicker(true)}
      />
    )
  }

  return (
    <VeilEarlyAccessGate>
      <Suspense fallback={<ResolutionScreen onRetry={resolve} />}>
        <NetHubPage osSession={state.session} />
      </Suspense>
    </VeilEarlyAccessGate>
  )
}
