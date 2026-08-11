import type { NetActiveIdentityState } from './netActiveIdentity'
import type {
  NetActiveIdentitySession,
  NetPlayableLinkedIdentity,
} from './useNetActiveIdentitySession'
import type { NetGmPersonaController } from './useNetGmPersona'
import { NetGmPersonaSettings } from './NetGmPersonaSettings'
import { getNetIdentitySubjectId } from './netIdentitySelectors'
import type {
  NetPlayableIdentityCandidate,
  NetPlayableIdentityCandidateState,
} from './netIdentityTypes'
import { useEffect, useMemo, useState } from 'react'
import { SharedMediaImage } from '../../shared/SharedMediaImage'

interface NetIdentitySettingsProps {
  readonly activeIdentity: NetActiveIdentityState
  readonly candidates: NetPlayableIdentityCandidateState
  readonly activeIdentitySession: NetActiveIdentitySession
  readonly gmPersona: NetGmPersonaController
  readonly accountProfile: {
    readonly displayName: string
    readonly handle: string
  } | null
}

function candidateKey(candidate: NetPlayableIdentityCandidate) {
  return `${candidate.subject.kind}:${getNetIdentitySubjectId(candidate.subject)}`
}

function candidateInitials(candidate: NetPlayableIdentityCandidate) {
  return candidate.displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'NV'
}

function sourceLabel(candidate: NetPlayableIdentityCandidate) {
  switch (candidate.sourceKind) {
    case 'profile-sheet':
      return 'PROFILE SHEET'
    case 'npc-card':
      return 'NPC CARD'
    case 'character':
      return 'CAMPAIGN CHARACTER'
  }
}

function accessLabel(candidate: NetPlayableIdentityCandidate) {
  switch (candidate.accessKind) {
    case 'self-profile':
      return 'CURRENT PROFILE SHEET'
    case 'owner':
      return 'OWNED CANDIDATE'
    case 'shared':
      return 'SHARED ACCESS'
    case 'gm':
      return 'GM-VISIBLE'
  }
}

function profileFacts(candidate: NetPlayableIdentityCandidate) {
  return [candidate.age, candidate.occupation, candidate.city].filter(
    (value): value is string => Boolean(value),
  )
}

function CandidatePortrait({ candidate }: { readonly candidate: NetPlayableIdentityCandidate }) {
  if (candidate.avatarUrl) {
    return <SharedMediaImage source={candidate.avatarUrl} variant="thumbnail" alt="" loading="lazy" decoding="async" fallback={<span aria-hidden="true">{candidateInitials(candidate)}</span>} />
  }

  return <span aria-hidden="true">{candidateInitials(candidate)}</span>
}

function CandidateRow({
  candidate,
  selected,
  onSelect,
  action,
  activeLabel,
}: {
  readonly candidate: NetPlayableIdentityCandidate
  readonly selected: boolean
  readonly onSelect: (candidate: NetPlayableIdentityCandidate) => void
  readonly action?: {
    readonly label: string
    readonly busy?: boolean
    readonly disabled?: boolean
    readonly onAction: () => void
  }
  readonly activeLabel?: string
}) {
  const facts = profileFacts(candidate)

  return (
    <div className="net-identity-settings__candidate-row" data-active={activeLabel ? 'true' : 'false'}>
      <button
        type="button"
        className="net-identity-settings__candidate"
        data-selected={selected ? 'true' : 'false'}
        onClick={() => onSelect(candidate)}
        aria-pressed={selected}
      >
        <span className="net-identity-settings__portrait">
          <CandidatePortrait candidate={candidate} />
        </span>
        <span className="net-identity-settings__candidate-copy">
          <strong>{candidate.displayName}</strong>
          <span>{facts.length ? facts.join(' · ') : 'No sheet summary available'}</span>
        </span>
        <span className="net-identity-settings__candidate-state">
          <span>{sourceLabel(candidate)}</span>
          <b>{accessLabel(candidate)}</b>
        </span>
      </button>
      {action ? (
        <button
          type="button"
          className="net-identity-settings__switch"
          data-active={selected ? 'true' : 'false'}
          disabled={action.disabled || action.busy}
          onClick={action.onAction}
          aria-label={`${action.label}: ${candidate.displayName}`}
        >
          {action.busy ? 'SWITCHING…' : action.label}
        </button>
      ) : null}
      {activeLabel ? <span className="net-identity-settings__active">{activeLabel}</span> : null}
    </div>
  )
}

function CandidateDetail({ candidate }: { readonly candidate: NetPlayableIdentityCandidate }) {
  const fields = [
    ['Name', candidate.displayName],
    ['Age', candidate.age],
    ['Gender', candidate.gender],
    ['Occupation', candidate.occupation],
    ['City', candidate.city],
    ['Source', sourceLabel(candidate)],
    ['Access', accessLabel(candidate)],
    ['Classification', candidate.playability === 'confirmed' ? 'CONFIRMED PLAYABLE' : candidate.playability.toUpperCase()],
  ].filter((field): field is [string, string] => Boolean(field[1]))

  return (
    <aside className="net-identity-settings__detail" aria-live="polite">
      <div className="net-identity-settings__detail-heading">
        <span className="net-identity-settings__portrait">
          <CandidatePortrait candidate={candidate} />
        </span>
        <div>
          <strong>{candidate.displayName}</strong>
          <span>{sourceLabel(candidate)}</span>
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
    </aside>
  )
}

function LoadingState() {
  return (
    <div className="net-identity-settings__empty" aria-live="polite">
      <strong>READING AUTHORISED SHEETS</strong>
      <span>Character identities are being resolved for this account.</span>
    </div>
  )
}

export function NetIdentitySettings({
  activeIdentity,
  candidates,
  activeIdentitySession,
  gmPersona,
  accountProfile,
}: NetIdentitySettingsProps) {
  const readyCandidates = candidates.status === 'ready' ? candidates.candidates : []
  const linkedCandidates = activeIdentitySession.availablePlayableIdentities
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const currentLinkedCandidate = activeIdentitySession.activeIdentityLink
    ? linkedCandidates.find(({ link }) => link.id === activeIdentitySession.activeIdentityLink?.id)
    : undefined
  const currentCandidate = currentLinkedCandidate?.candidate
  const selectedCandidate = useMemo(
    () => readyCandidates.find((candidate) => candidateKey(candidate) === selectedKey)
      ?? linkedCandidates.find(({ candidate }) => candidateKey(candidate) === selectedKey)?.candidate
      ?? currentCandidate
      ?? linkedCandidates[0]?.candidate
      ?? readyCandidates[0],
    [currentCandidate, linkedCandidates, readyCandidates, selectedKey],
  )

  useEffect(() => {
    setSelectedKey(currentCandidate ? candidateKey(currentCandidate) : null)
  }, [candidates.status === 'ready' ? candidates.authenticatedProfileId : undefined, currentCandidate])

  if (candidates.status === 'loading') return <LoadingState />

  if (candidates.status === 'error') {
    return (
      <div className="net-identity-settings__empty" role="status">
        <strong>IDENTITIES UNAVAILABLE</strong>
        <span>{candidates.reason}</span>
        {candidates.retry ? <button type="button" onClick={candidates.retry}>RETRY</button> : null}
      </div>
    )
  }

  const isGm = activeIdentity.status === 'gm-no-persona'
  return (
    <section className="net-identity-settings" aria-labelledby="net-identity-settings-title">
      <header className="net-identity-settings__header">
        <div>
          <h2 id="net-identity-settings-title">{isGm ? 'Persona Control' : 'Characters / Identity'}</h2>
          <p>{isGm
            ? 'Inspect authorised identities or enter an NPC context without changing the authenticated account.'
            : 'Active character selection is stored through the New Vega identity service.'}</p>
        </div>
        <span className="net-identity-settings__readonly">IDENTITY SERVICE</span>
      </header>

      <div className="net-identity-settings__account">
        <span>ACCOUNT</span>
        <strong>{accountProfile?.displayName ?? 'Authenticated session'}</strong>
        <em>{accountProfile?.handle ? `@${accountProfile.handle.replace(/^@+/, '')}` : 'SITE ACCOUNT'}</em>
      </div>

      {isGm ? (
        <NetGmPersonaSettings
          candidates={readyCandidates}
          controller={gmPersona}
          authenticatedProfileId={candidates.authenticatedProfileId}
          warning={candidates.warning}
          onRetrySummaries={candidates.retry}
        />
      ) : currentCandidate ? (
        <div className="net-identity-settings__current">
          <span>Active character</span>
          <CandidateRow
            candidate={currentCandidate}
            selected={candidateKey(currentCandidate) === candidateKey(selectedCandidate ?? currentCandidate)}
            onSelect={(candidate) => setSelectedKey(candidateKey(candidate))}
          />
        </div>
      ) : activeIdentity.status === 'selection-required' ? (
        <div className="net-identity-settings__session-state" role="status">
          <strong>CHARACTER SELECTION REQUIRED</strong>
          <span>{activeIdentity.reason}</span>
        </div>
      ) : (
        <div className="net-identity-settings__session-state">
          <strong>IDENTITY NOT LINKED</strong>
          <span>No profile-sheet identity is available for this account.</span>
        </div>
      )}

      {!isGm ? (
        <div className="net-identity-settings__group">
          <h3>Your characters</h3>
          {linkedCandidates.length ? linkedCandidates.map(({ link, candidate }: NetPlayableLinkedIdentity) => {
            const isActive = link.id === activeIdentitySession.activeIdentityLink?.id
            const isSwitching = activeIdentitySession.switchingIdentityLinkId === link.id

            return (
            <CandidateRow
              key={link.id}
              candidate={candidate}
              selected={candidateKey(candidate) === candidateKey(selectedCandidate ?? candidate)}
              onSelect={(nextCandidate) => setSelectedKey(candidateKey(nextCandidate))}
              {...(isActive ? { activeLabel: 'ACTIVE' } : {})}
              {...(!isActive ? {
                action: {
                  label: 'SWITCH',
                  busy: isSwitching,
                  disabled: activeIdentitySession.switching,
                  onAction: () => { void activeIdentitySession.switchIdentity(link.id) },
                },
              } : {})}
            />
            )
          }) : (
            <p className="net-identity-settings__quiet">No server-authorised playable characters are currently available.</p>
          )}
        </div>
      ) : null}

      {!isGm && candidates.warning ? <p className="net-identity-settings__warning">
        {candidates.warning}{candidates.retry ? <> <button type="button" onClick={candidates.retry}>RETRY</button></> : null}
      </p> : null}
      {!isGm && activeIdentitySession.error ? (
        <p className="net-identity-settings__warning" role="alert">{activeIdentitySession.error}</p>
      ) : null}
      {!isGm && selectedCandidate ? <CandidateDetail candidate={selectedCandidate} /> : null}
    </section>
  )
}
