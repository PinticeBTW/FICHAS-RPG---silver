import { Eye, RotateCcw, Search, ShieldAlert, UserRoundCog, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  fetchNetGmIdentityDetail,
  type NetGmIdentityDetail,
} from '../../../lib/netGmIdentityDirectoryService'
import type { NetIdentityLink } from '../../../lib/netIdentityService'
import type { NetGmPersonaController } from './useNetGmPersona'
import { NetGmRemoteSystemSnapshot } from './NetGmRemoteSystemSnapshot'
import { getNetIdentitySubjectId } from './netIdentitySelectors'
import type { NetSelectableGmPersonaMode } from './netGmPersonaTypes'
import type { NetPlayableIdentityCandidate } from './netIdentityTypes'
import { SharedMediaImage } from '../../shared/SharedMediaImage'

interface NetGmPersonaSettingsProps {
  readonly candidates: readonly NetPlayableIdentityCandidate[]
  readonly controller: NetGmPersonaController
  readonly authenticatedProfileId: string
  readonly warning?: string
  readonly onRetrySummaries?: () => void
}

type PendingPersonaAction = {
  readonly key: string
  readonly mode: NetSelectableGmPersonaMode | 'none'
}

type PersonaIdentityClassification = 'player' | 'npc'

type PersonaDetailLoadState =
  | { readonly status: 'loading'; readonly profileId: string; readonly key: string }
  | { readonly status: 'ready'; readonly profileId: string; readonly key: string; readonly detail: NetGmIdentityDetail }
  | { readonly status: 'error'; readonly profileId: string; readonly key: string; readonly reason: string }

function subjectKey(subject: NetPlayableIdentityCandidate['subject']): string {
  return `${subject.kind}:${getNetIdentitySubjectId(subject)}`
}

/**
 * Sheet storage is legacy implementation detail. Only a server-authoritative
 * playable player link promotes a subject into the Player Identity group.
 */
function classifyPersonaIdentity(
  candidate: NetPlayableIdentityCandidate,
  identityLinks: readonly NetIdentityLink[],
): PersonaIdentityClassification {
  if (candidate.authoritativeLink) {
    return candidate.authoritativeLink.identityKind === 'player'
      && candidate.authoritativeLink.playability === 'playable'
      ? 'player'
      : 'npc'
  }
  const candidateKey = subjectKey(candidate.subject)
  const link = identityLinks.find((identityLink) => (
    subjectKey(identityLink.subject) === candidateKey
  ))

  return link?.identityKind === 'player' && link.playability === 'playable'
    ? 'player'
    : 'npc'
}

function candidateInitials(candidate: NetPlayableIdentityCandidate): string {
  return candidate.displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'NV'
}

function sourceLabel(candidate: NetPlayableIdentityCandidate): string {
  switch (candidate.sourceKind) {
    case 'profile-sheet':
      return 'PROFILE SHEET'
    case 'npc-card':
      return 'NPC CARD'
    case 'character':
      return 'CAMPAIGN CHARACTER'
  }
}

function ownerLabel(candidate: NetPlayableIdentityCandidate): string {
  if (candidate.ownerDisplayName) return candidate.ownerDisplayName
  return candidate.sourceKind === 'profile-sheet' ? 'Authorised player account' : 'GM-controlled record'
}

function CandidatePortrait({ candidate }: { readonly candidate: NetPlayableIdentityCandidate }) {
  return (
    <span className="net-persona-control__portrait">
      {candidate.avatarUrl
        ? <SharedMediaImage source={candidate.avatarUrl} variant="thumbnail" alt="" loading="lazy" decoding="async" fallback={<span aria-hidden="true">{candidateInitials(candidate)}</span>} />
        : <span aria-hidden="true">{candidateInitials(candidate)}</span>}
    </span>
  )
}

function sessionModeForCandidate(
  candidate: NetPlayableIdentityCandidate,
  controller: NetGmPersonaController,
): NetSelectableGmPersonaMode | undefined {
  const session = controller.session
  if (!session || session.mode === 'none') return undefined
  return subjectKey(session.subject) === subjectKey(candidate.subject) ? session.mode : undefined
}

function identityLinkIdForCandidate(
  candidate: NetPlayableIdentityCandidate,
  identityLinks: readonly NetIdentityLink[],
): string | undefined {
  if (candidate.authoritativeLink) return candidate.authoritativeLink.id
  const candidateKey = subjectKey(candidate.subject)
  return identityLinks.find((identityLink) => (
    subjectKey(identityLink.subject) === candidateKey
  ))?.id
}

function PersonaCandidateRow({
  candidate,
  classification,
  selected,
  sessionMode,
  onSelect,
}: {
  readonly candidate: NetPlayableIdentityCandidate
  readonly classification: PersonaIdentityClassification
  readonly selected: boolean
  readonly sessionMode?: NetSelectableGmPersonaMode
  readonly onSelect: () => void
}) {
  const summary = [candidate.occupation, candidate.city].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      className="net-persona-control__identity-row"
      data-selected={selected ? 'true' : 'false'}
      data-session={sessionMode ?? 'none'}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <CandidatePortrait candidate={candidate} />
      <span className="net-persona-control__identity-copy">
        <strong>{candidate.displayName}</strong>
        <span>{summary || `Owner: ${ownerLabel(candidate)}`}</span>
      </span>
      <span className="net-persona-control__identity-source">
        <span>{classification === 'player' ? 'PLAYER CHARACTER' : 'NPC IDENTITY'} // {sourceLabel(candidate)}</span>
        <b>{sessionMode === 'compromised-session' ? 'COMPROMISED' : sessionMode === 'gm-persona' ? 'ACTING' : sessionMode === 'inspect' ? 'INSPECTING' : `OWNER // ${ownerLabel(candidate)}`}</b>
      </span>
    </button>
  )
}

function PersonaDetail({
  authenticatedProfileId,
  candidate,
  classification,
  controller,
  pending,
  onAction,
  confirmingTakeControl,
  onRequestTakeControl,
  onCancelTakeControl,
  detailState,
  onRetryDetail,
}: {
  readonly authenticatedProfileId: string
  readonly candidate: NetPlayableIdentityCandidate
  readonly classification: PersonaIdentityClassification
  readonly controller: NetGmPersonaController
  readonly pending: PendingPersonaAction | null
  readonly onAction: (mode: NetSelectableGmPersonaMode) => void
  readonly confirmingTakeControl: boolean
  readonly onRequestTakeControl: () => void
  readonly onCancelTakeControl: () => void
  readonly detailState: PersonaDetailLoadState | null
  readonly onRetryDetail: () => void
}) {
  const key = subjectKey(candidate.subject)
  const summaryReady = candidate.summaryStatus === 'ready'
  // Never offer a client-side route into persona authoring until the GM's
  // server-authoritative link classification has completed. The RPC remains
  // the final authority even after this presentation guard.
  const canActAs = (
    (candidate.gmCapabilities?.actAs ?? (
      classification === 'npc' && candidate.subject.kind === 'npc-card'
    ))
    && summaryReady
    && controller.state.status !== 'loading'
    && controller.state.status !== 'error'
  )
  const identityLinkId = identityLinkIdForCandidate(candidate, controller.identityLinks)
  const canTakeControl = (
    (candidate.gmCapabilities?.takeControl ?? (
      classification === 'player' && Boolean(identityLinkId)
    ))
    && summaryReady
    && controller.state.status !== 'loading'
    && controller.state.status !== 'error'
  )
  const currentMode = sessionModeForCandidate(candidate, controller)
  const matchingDetailState = detailState?.profileId === authenticatedProfileId
    && detailState.key === key
    ? detailState
    : null
  const snapshotIdentityLinkId = currentMode ? identityLinkId : undefined
  const fields = [
    ['Age', candidate.age],
    ['Gender', candidate.gender],
    ['Occupation', candidate.occupation],
    ['City', candidate.city],
    ['Identity class', classification === 'player' ? 'PLAYER CHARACTER' : 'NPC IDENTITY'],
    ['Source', sourceLabel(candidate)],
    ['Owner account', ownerLabel(candidate)],
    ['Mode available', !summaryReady ? 'SUMMARY SYNC REQUIRED' : canActAs ? 'INSPECT / ACT AS' : canTakeControl ? 'INSPECT / TAKE CONTROL' : 'INSPECT ONLY'],
  ].filter((field): field is [string, string] => Boolean(field[1]))
  const inspectPending = pending?.key === key && pending.mode === 'inspect'
  const actPending = pending?.key === key && pending.mode === 'gm-persona'
  const compromisePending = pending?.key === key && pending.mode === 'compromised-session'

  return (
    <aside className="net-persona-control__detail" aria-labelledby="net-persona-detail-name">
      <div className="net-persona-control__detail-heading">
        <CandidatePortrait candidate={candidate} />
        <div>
          <strong id="net-persona-detail-name">{candidate.displayName}</strong>
          <span>{sourceLabel(candidate)} // {currentMode ? currentMode.replace('-', ' ').toUpperCase() : 'AVAILABLE'}</span>
        </div>
      </div>

      <dl>
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {!matchingDetailState || matchingDetailState.status === 'loading' ? (
        <p className="net-persona-control__pending" role="status">SYNCING SELECTED CHARACTER DETAILS…</p>
      ) : null}
      {matchingDetailState?.status === 'error' ? (
        <p className="net-persona-control__warning" role="alert">
          Selected details are temporarily unavailable.{' '}
          <button type="button" onClick={onRetryDetail}>RETRY DETAIL</button>
        </p>
      ) : null}

      <div className="net-persona-control__detail-actions" aria-busy={controller.changing}>
        <button
          type="button"
          className="net-persona-control__inspect"
          disabled={controller.changing || !summaryReady}
          aria-pressed={currentMode === 'inspect'}
          onClick={() => onAction('inspect')}
        >
          <Eye size={14} />
          {inspectPending ? 'INSPECTING…' : currentMode === 'inspect' ? 'INSPECTING' : 'INSPECT'}
        </button>
        {canActAs ? (
          <button
            type="button"
            className="net-persona-control__act"
            disabled={controller.changing}
            aria-pressed={currentMode === 'gm-persona'}
            onClick={() => onAction('gm-persona')}
          >
            <UserRoundCog size={14} />
            {actPending ? 'ENTERING…' : currentMode === 'gm-persona' ? 'ACTING AS' : 'ACT AS'}
          </button>
        ) : null}
        {canTakeControl ? (
          <button
            type="button"
            className="net-persona-control__take-control"
            disabled={controller.changing}
            aria-pressed={currentMode === 'compromised-session'}
            onClick={onRequestTakeControl}
          >
            <ShieldAlert size={14} />
            {compromisePending ? 'STARTING…' : currentMode === 'compromised-session' ? 'CONTROL ACTIVE' : 'TAKE CONTROL'}
          </button>
        ) : null}
      </div>
      {confirmingTakeControl && summaryReady ? (
        <section
          className="net-persona-control__compromise-confirm"
          role="alertdialog"
          aria-labelledby="net-persona-compromise-title"
          aria-describedby="net-persona-compromise-detail"
        >
          <div>
            <strong id="net-persona-compromise-title">START COMPROMISED SESSION</strong>
            <span>AUDITED PULSE AUTHORITY</span>
          </div>
          <p id="net-persona-compromise-detail">
            This narrative session can publish PULSE posts and replies through {candidate.displayName}'s existing account. Your authenticated GM account remains active, and every publication is recorded in the authoritative audit ledger.
          </p>
          <div>
            <button
              type="button"
              className="net-persona-control__take-control-confirm"
              autoFocus
              disabled={controller.changing}
              onClick={() => onAction('compromised-session')}
            >
              <ShieldAlert size={14} />
              {compromisePending ? 'STARTING…' : 'START COMPROMISED SESSION'}
            </button>
            <button
              type="button"
              className="net-persona-control__take-control-cancel"
              disabled={controller.changing}
              onClick={onCancelTakeControl}
            >
              CANCEL
            </button>
          </div>
        </section>
      ) : null}
      <p className="net-persona-control__authoring-note">
        {currentMode === 'compromised-session'
          ? 'Compromised authority is limited to audited PULSE posts and replies.'
          : 'Persona context is read-only. Application content authoring remains unavailable.'}
      </p>
      {currentMode ? (
        <NetGmRemoteSystemSnapshot
          authenticatedProfileId={authenticatedProfileId}
          identityLinkId={snapshotIdentityLinkId}
          identityName={candidate.displayName}
        />
      ) : null}
    </aside>
  )
}

export function NetGmPersonaSettings({
  candidates,
  controller,
  authenticatedProfileId,
  warning,
  onRetrySummaries,
}: NetGmPersonaSettingsProps) {
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingPersonaAction | null>(null)
  const [takeControlKey, setTakeControlKey] = useState<string | null>(null)
  const [detailRequestVersion, setDetailRequestVersion] = useState(0)
  const detailForceKeyRef = useRef<string | null>(null)
  const [detailState, setDetailState] = useState<PersonaDetailLoadState | null>(null)
  const sessionSubjectKey = controller.session && controller.session.mode !== 'none'
    ? subjectKey(controller.session.subject)
    : null

  useEffect(() => {
    setQuery('')
    setSelectedKey(null)
    setPending(null)
    setTakeControlKey(null)
  }, [authenticatedProfileId])

  useEffect(() => {
    if (sessionSubjectKey) setSelectedKey(sessionSubjectKey)
  }, [sessionSubjectKey])

  const supportedCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.subject.kind !== 'character'),
    [candidates],
  )
  const filteredCandidates = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return supportedCandidates

    return supportedCandidates.filter((candidate) => [
      candidate.displayName,
      candidate.ownerDisplayName,
      candidate.ownerHandle,
      candidate.occupation,
      candidate.city,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)))
  }, [query, supportedCandidates])

  const playerCandidates = filteredCandidates.filter((candidate) => (
    classifyPersonaIdentity(candidate, controller.identityLinks) === 'player'
  ))
  const npcCandidates = filteredCandidates.filter((candidate) => (
    classifyPersonaIdentity(candidate, controller.identityLinks) === 'npc'
  ))
  const selectedCandidate = filteredCandidates.find(
    (candidate) => subjectKey(candidate.subject) === selectedKey,
  ) ?? supportedCandidates.find((candidate) => sessionSubjectKey
    && subjectKey(candidate.subject) === sessionSubjectKey)
    ?? filteredCandidates[0]

  useEffect(() => {
    if (!selectedCandidate || selectedCandidate.subject.kind === 'character') {
      return undefined
    }

    const key = subjectKey(selectedCandidate.subject)
    const force = detailForceKeyRef.current === key
    if (force) detailForceKeyRef.current = null
    let cancelled = false

    void fetchNetGmIdentityDetail(
      authenticatedProfileId,
      selectedCandidate.subject,
      { force },
    ).then((detail) => {
      if (cancelled) return
      setDetailState({ status: 'ready', profileId: authenticatedProfileId, key, detail })
    }).catch((error: unknown) => {
      if (cancelled) return
      setDetailState({
        status: 'error',
        profileId: authenticatedProfileId,
        key,
        reason: error instanceof Error ? error.message : 'Selected character details could not be loaded.',
      })
    })

    return () => { cancelled = true }
  }, [authenticatedProfileId, detailRequestVersion, selectedCandidate])

  const hydratedSelectedCandidate = useMemo(() => {
    if (!selectedCandidate) return undefined
    const key = subjectKey(selectedCandidate.subject)
    if (
      detailState?.status !== 'ready'
      || detailState.profileId !== authenticatedProfileId
      || detailState.key !== key
    ) return selectedCandidate
    return {
      ...selectedCandidate,
      ...(detailState.detail.age ? { age: detailState.detail.age } : {}),
      ...(detailState.detail.gender ? { gender: detailState.detail.gender } : {}),
      ...(detailState.detail.occupation ? { occupation: detailState.detail.occupation } : {}),
      ...(detailState.detail.city ? { city: detailState.detail.city } : {}),
    }
  }, [authenticatedProfileId, detailState, selectedCandidate])

  const runPersonaAction = async (
    candidate: NetPlayableIdentityCandidate,
    mode: NetSelectableGmPersonaMode,
  ) => {
    if (candidate.subject.kind === 'character') return
    const key = subjectKey(candidate.subject)
    setPending({ key, mode })
    const succeeded = await controller.setPersona(candidate.subject, mode)
    if (succeeded) {
      setSelectedKey(key)
      setTakeControlKey(null)
    }
    setPending(null)
  }

  const clearPersona = async () => {
    setPending({ key: 'session', mode: 'none' })
    const succeeded = await controller.clearPersona()
    if (succeeded) setSelectedKey(null)
    setPending(null)
  }

  const activeCandidate = sessionSubjectKey
    ? supportedCandidates.find((candidate) => subjectKey(candidate.subject) === sessionSubjectKey)
    : undefined
  const sessionState = controller.state.status === 'inspect'
    ? 'INSPECTING'
    : controller.state.status === 'compromised'
      ? 'COMPROMISED'
    : controller.state.status === 'active'
      ? 'ACTING AS'
      : controller.state.status === 'loading'
        ? 'RESOLVING PERSONA'
        : controller.state.status === 'error'
          ? 'PERSONA UNAVAILABLE'
          : 'NO ACTIVE PERSONA'

  return (
    <div className="net-persona-control">
      <section
        className="net-persona-control__session"
        data-active={activeCandidate ? 'true' : 'false'}
        data-mode={controller.state.status === 'compromised' ? 'compromised-session' : 'standard'}
        aria-live="polite"
        aria-busy={controller.changing}
      >
        <div className="net-persona-control__session-label">
          <strong>GM SESSION</strong>
          <span>{sessionState}</span>
        </div>
        {activeCandidate ? (
          <div className="net-persona-control__session-identity">
            <CandidatePortrait candidate={activeCandidate} />
            <div>
              <strong>{activeCandidate.displayName}</strong>
              <span>{sourceLabel(activeCandidate)} // {controller.state.status === 'compromised' ? 'AUDITED PULSE CONTROL' : controller.state.status === 'active' ? 'NPC PERSONA' : 'INSPECTION CONTEXT'}</span>
            </div>
          </div>
        ) : (
          <p>The authenticated GM remains in system control with no fictional author selected.</p>
        )}
        {controller.session && controller.session.mode !== 'none' ? (
          <button
            type="button"
            className="net-persona-control__clear"
            disabled={controller.changing}
            onClick={() => { void clearPersona() }}
          >
            <RotateCcw size={14} />
            {pending?.mode === 'none' ? 'RETURNING…' : 'RETURN TO GM'}
          </button>
        ) : null}
      </section>

      <label className="net-persona-control__search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          aria-label="Search available identities"
          value={query}
          placeholder="Search characters, owners, occupation or city"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear persona search">
            <X size={13} />
          </button>
        ) : null}
      </label>

      {controller.error ? (
        <p className="net-persona-control__error" role="alert">{controller.error}</p>
      ) : null}
      {controller.state.status === 'error' ? (
        <p className="net-persona-control__error" role="alert">{controller.state.reason}</p>
      ) : null}
      {pending ? (
        <p className="net-persona-control__pending" role="status">
          {pending.mode === 'none' ? 'RETURNING TO GM CONTROL…' : 'AWAITING PERSONA SERVICE CONFIRMATION…'}
        </p>
      ) : null}
      {warning ? <p className="net-persona-control__warning" role="status">
        {warning}{onRetrySummaries ? <> <button type="button" onClick={onRetrySummaries}>RETRY</button></> : null}
      </p> : null}

      <div className="net-persona-control__workspace">
        <div className="net-persona-control__directory" aria-label="Available persona identities">
          <section className="net-persona-control__group">
            <header>
              <h3>Player identities</h3>
              <span>{playerCandidates.length}</span>
            </header>
            {playerCandidates.map((candidate) => (
              <PersonaCandidateRow
                key={subjectKey(candidate.subject)}
                candidate={candidate}
                classification={classifyPersonaIdentity(candidate, controller.identityLinks)}
                selected={subjectKey(candidate.subject) === subjectKey(selectedCandidate?.subject ?? candidate.subject)}
                sessionMode={sessionModeForCandidate(candidate, controller)}
                onSelect={() => {
                  setSelectedKey(subjectKey(candidate.subject))
                  setTakeControlKey(null)
                }}
              />
            ))}
            {!playerCandidates.length ? <p>No matching player identities.</p> : null}
          </section>

          <section className="net-persona-control__group">
            <header>
              <h3>NPC identities</h3>
              <span>{npcCandidates.length}</span>
            </header>
            {npcCandidates.map((candidate) => (
              <PersonaCandidateRow
                key={subjectKey(candidate.subject)}
                candidate={candidate}
                classification={classifyPersonaIdentity(candidate, controller.identityLinks)}
                selected={subjectKey(candidate.subject) === subjectKey(selectedCandidate?.subject ?? candidate.subject)}
                sessionMode={sessionModeForCandidate(candidate, controller)}
                onSelect={() => {
                  setSelectedKey(subjectKey(candidate.subject))
                  setTakeControlKey(null)
                }}
              />
            ))}
            {!npcCandidates.length ? <p>No matching NPC identities.</p> : null}
          </section>
        </div>

        {hydratedSelectedCandidate ? (
          <PersonaDetail
            authenticatedProfileId={authenticatedProfileId}
            candidate={hydratedSelectedCandidate}
            classification={classifyPersonaIdentity(hydratedSelectedCandidate, controller.identityLinks)}
            controller={controller}
            pending={pending}
            onAction={(mode) => { void runPersonaAction(hydratedSelectedCandidate, mode) }}
            confirmingTakeControl={takeControlKey === subjectKey(hydratedSelectedCandidate.subject)}
            onRequestTakeControl={() => setTakeControlKey(subjectKey(hydratedSelectedCandidate.subject))}
            onCancelTakeControl={() => setTakeControlKey(null)}
            detailState={detailState}
            onRetryDetail={() => {
              setDetailState({
                status: 'loading',
                profileId: authenticatedProfileId,
                key: subjectKey(hydratedSelectedCandidate.subject),
              })
              detailForceKeyRef.current = subjectKey(hydratedSelectedCandidate.subject)
              setDetailRequestVersion((version) => version + 1)
            }}
          />
        ) : (
          <div className="net-persona-control__empty" role="status">
            <strong>NO IDENTITIES AVAILABLE</strong>
            <span>The authorised sheet directory returned no persona candidates.</span>
          </div>
        )}
      </div>
    </div>
  )
}
