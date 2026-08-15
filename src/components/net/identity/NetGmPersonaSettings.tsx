import { CircleDollarSign, Eye, Laptop, RotateCcw, Search, ShieldAlert, UserRoundCog, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  fetchNetGmIdentityDetail,
  type NetGmIdentityDetail,
} from '../../../lib/netGmIdentityDirectoryService'
import {
  fetchNetGmIdentityOs,
  notifyNetOsAuthorityChanged,
  setNetGmIdentityPrimaryOs,
  type NetGmIdentityOsAssignment,
} from '../../../lib/netOsService'
import {
  enableNetGmNpcNetworkIdentity,
  type NetIdentityLink,
} from '../../../lib/netIdentityService'
import {
  getNetOsLabel,
  netOsOptions,
  suggestNetOsForCity,
  type NetOsId,
} from '../../../lib/netOsTypes'
import type { NetGmPersonaController } from './useNetGmPersona'
import { NetGmRemoteSystemSnapshot } from './NetGmRemoteSystemSnapshot'
import { getNetIdentitySubjectId } from './netIdentitySelectors'
import type { NetSelectableGmPersonaMode } from './netGmPersonaTypes'
import type { NetPlayableIdentityCandidate } from './netIdentityTypes'
import { SharedMediaImage } from '../../shared/SharedMediaImage'
import {
  fetchNetAltaraEconomyConfiguration,
  setNetAltaraIdentityCurrency,
} from '../../../lib/netAltaraBankService'
import type { NetAltaraCurrencyCode } from '../../../lib/netAltaraBankTypes'
import { notifySheetEconomyAuthorityChanged } from '../../../lib/sheetEconomyService'

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

type PrimaryOsControlState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly assignment: NetGmIdentityOsAssignment }
  | { readonly status: 'error'; readonly reason: string }

type PersonaDetailLoadState =
  | { readonly status: 'loading'; readonly profileId: string; readonly key: string }
  | { readonly status: 'ready'; readonly profileId: string; readonly key: string; readonly detail: NetGmIdentityDetail }
  | { readonly status: 'error'; readonly profileId: string; readonly key: string; readonly reason: string }

function NetGmPrimaryOsControl({
  identityLinkId,
  city,
  allowNoOs,
  reconcileEffectiveOs,
}: {
  readonly identityLinkId: string
  readonly city?: string
  readonly allowNoOs: boolean
  readonly reconcileEffectiveOs: boolean
}) {
  const [state, setState] = useState<PrimaryOsControlState>({ status: 'loading' })
  const [selectedOsId, setSelectedOsId] = useState<NetOsId | 'none'>(allowNoOs ? 'none' : 'veil')
  const [saving, setSaving] = useState(false)
  const [loadVersion, setLoadVersion] = useState(0)
  const suggestion = suggestNetOsForCity(city)

  useEffect(() => {
    let cancelled = false
    void fetchNetGmIdentityOs(identityLinkId)
      .then((assignment) => {
        if (cancelled) return
        setSelectedOsId(assignment.primaryOsId ?? 'none')
        setState({ status: 'ready', assignment })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          reason: error instanceof Error ? error.message : 'Operating-system assignment is unavailable.',
        })
      })
    return () => { cancelled = true }
  }, [identityLinkId, loadVersion])

  const save = async () => {
    if (saving || state.status !== 'ready') return
    setSaving(true)
    try {
      const assignment = await setNetGmIdentityPrimaryOs(
        identityLinkId,
        selectedOsId === 'none' ? null : selectedOsId,
      )
      setSelectedOsId(assignment.primaryOsId ?? 'none')
      setState({ status: 'ready', assignment })
      if (reconcileEffectiveOs) notifyNetOsAuthorityChanged()
      notifySheetEconomyAuthorityChanged()
    } catch (error) {
      setState({
        status: 'error',
        reason: error instanceof Error ? error.message : 'Operating-system assignment could not be changed.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="net-persona-control__os" aria-label="Operating system authority">
      <header>
        <Laptop size={15} aria-hidden="true" />
        <div>
          <span>OPERATING SYSTEM</span>
          <strong>{state.status === 'ready'
            ? state.assignment.primaryOsId ? getNetOsLabel(state.assignment.primaryOsId) : 'NO OS'
            : 'RESOLVING…'}</strong>
        </div>
      </header>

      {state.status === 'error' ? (
        <p role="alert">
          {state.reason}{' '}
          <button
            type="button"
            onClick={() => {
              setState({ status: 'loading' })
              setLoadVersion((version) => version + 1)
            }}
          >
            RETRY
          </button>
        </p>
      ) : (
        <div className="net-persona-control__os-action">
          <label>
            <span className="sr-only">Primary operating system</span>
            <select
              value={selectedOsId}
              disabled={saving || state.status !== 'ready'}
              onChange={(event) => setSelectedOsId(event.target.value as NetOsId | 'none')}
            >
              {allowNoOs ? <option value="none">NO OS</option> : null}
              {netOsOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={
              saving
              || state.status !== 'ready'
              || selectedOsId === (state.assignment.primaryOsId ?? 'none')
            }
            onClick={() => { void save() }}
          >
            {saving ? 'CHANGING…' : 'CHANGE OS'}
          </button>
        </div>
      )}

      <small>
        {suggestion
          ? `${city ?? 'City'} suggests ${getNetOsLabel(suggestion)}. The explicit assignment above remains authoritative.`
          : 'CITY is descriptive. Only this explicit GM assignment controls OS access.'}
      </small>
    </section>
  )
}

function NetGmEconomicCurrencyControl({
  identityLinkId,
  city,
}: {
  readonly identityLinkId: string
  readonly city?: string
}) {
  const [configuration, setConfiguration] = useState<Awaited<ReturnType<typeof fetchNetAltaraEconomyConfiguration>>>()
  const [selected, setSelected] = useState<NetAltaraCurrencyCode | 'none'>('none')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [loadVersion, setLoadVersion] = useState(0)

  useEffect(() => {
    let active = true
    setError(undefined)
    void fetchNetAltaraEconomyConfiguration(identityLinkId)
      .then((next) => {
        if (!active) return
        setConfiguration(next)
        setSelected(next.identityCurrency?.currencyCode ?? 'none')
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Currency assignment is unavailable.') })
    return () => { active = false }
  }, [identityLinkId, loadVersion])

  const save = async () => {
    if (saving || !reason.trim()) return
    setSaving(true)
    setError(undefined)
    try {
      const next = await setNetAltaraIdentityCurrency({
        identityLinkId,
        ...(selected === 'none' ? {} : { currencyCode: selected }),
        reason: reason.trim(),
      })
      setConfiguration(next)
      setSelected(next.identityCurrency?.currencyCode ?? 'none')
      setReason('')
      notifySheetEconomyAuthorityChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Currency assignment could not be changed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="net-persona-control__os" aria-label="Economic currency authority">
      <header>
        <CircleDollarSign size={15} aria-hidden="true" />
        <div><span>HOME CURRENCY</span><strong>{configuration?.identityCurrency ? `${configuration.identityCurrency.currencyCode} — ${configuration.identityCurrency.pluralLabel}` : 'CURRENCY ASSIGNMENT REQUIRED'}</strong></div>
      </header>
      <div className="net-persona-control__os-action">
        <label><span className="sr-only">Authoritative home currency</span><select value={selected} disabled={saving || !configuration} onChange={(event) => setSelected(event.target.value as NetAltaraCurrencyCode | 'none')}><option value="none">NO CURRENCY</option>{configuration?.currencies.filter((currency) => currency.status === 'active').map((currency) => <option key={currency.currencyCode} value={currency.currencyCode}>{currency.currencyCode} — {currency.pluralLabel}</option>)}</select></label>
        <button type="button" disabled={saving || !configuration || !reason.trim() || selected === (configuration.identityCurrency?.currencyCode ?? 'none')} onClick={() => { void save() }}>{saving ? 'CHANGING…' : 'CHANGE CURRENCY'}</button>
      </div>
      <label><span className="sr-only">Currency assignment audit reason</span><input value={reason} maxLength={200} placeholder="Mandatory audit reason" onChange={(event) => setReason(event.target.value)} /></label>
      {error ? <p role="alert">{error} <button type="button" onClick={() => setLoadVersion((version) => version + 1)}>RETRY</button></p> : null}
      <small>{city ? `${city} is advisory lore only. ` : ''}Only this explicit assignment denominates a future ALTARA BANK account. Existing money is never relabelled.</small>
    </section>
  )
}

type NpcNetworkIdentityState =
  | { readonly status: 'idle' }
  | { readonly status: 'enabling' }
  | { readonly status: 'enabled' }
  | { readonly status: 'error'; readonly reason: string }

function NetGmNpcNetworkIdentityControl({
  subject,
  onEnabled,
}: {
  readonly subject: Extract<NetPlayableIdentityCandidate['subject'], { readonly kind: 'npc-card' }>
  readonly onEnabled?: () => void
}) {
  const [state, setState] = useState<NpcNetworkIdentityState>({ status: 'idle' })

  const enable = async () => {
    if (state.status === 'enabling' || state.status === 'enabled') return
    setState({ status: 'enabling' })
    try {
      await enableNetGmNpcNetworkIdentity(subject)
      setState({ status: 'enabled' })
      onEnabled?.()
    } catch (error) {
      setState({
        status: 'error',
        reason: error instanceof Error ? error.message : 'NPC network identity could not be enabled.',
      })
    }
  }

  return (
    <section className="net-persona-control__os" aria-label="NPC network identity">
      <header>
        <Laptop size={15} aria-hidden="true" />
        <div>
          <span>OPERATING SYSTEM</span>
          <strong>NETWORK IDENTITY REQUIRED</strong>
        </div>
      </header>
      <p>
        This NPC card has no network identity. Enabling one creates no player control and assigns no operating system.
      </p>
      <div className="net-persona-control__os-action">
        <span />
        <button
          type="button"
          disabled={state.status === 'enabling' || state.status === 'enabled'}
          onClick={() => { void enable() }}
        >
          {state.status === 'enabling'
            ? 'ENABLING…'
            : state.status === 'enabled' ? 'ENABLED // REFRESHING' : 'ENABLE NETWORK IDENTITY'}
        </button>
      </div>
      {state.status === 'error' ? <p role="alert">{state.reason}</p> : null}
    </section>
  )
}

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
        <b>{sessionMode === 'take-control'
          ? classification === 'npc' ? 'ACTING' : 'TAKE CONTROL'
          : sessionMode === 'compromised-session' ? 'PULSE CONTROL'
            : sessionMode === 'gm-persona' ? 'LEGACY PERSONA'
              : sessionMode === 'inspect' ? 'INSPECTING' : `OWNER // ${ownerLabel(candidate)}`}</b>
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
  confirmingCompromise,
  onRequestCompromise,
  onCancelCompromise,
  localInspect,
  detailState,
  onRetryDetail,
  onNetworkIdentityEnabled,
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
  readonly confirmingCompromise: boolean
  readonly onRequestCompromise: () => void
  readonly onCancelCompromise: () => void
  readonly localInspect: boolean
  readonly detailState: PersonaDetailLoadState | null
  readonly onRetryDetail: () => void
  readonly onNetworkIdentityEnabled?: () => void
}) {
  const key = subjectKey(candidate.subject)
  const summaryReady = candidate.summaryStatus === 'ready'
  const identityLinkId = identityLinkIdForCandidate(candidate, controller.identityLinks)
  // Never offer a client-side route into persona authoring until the GM's
  // server-authoritative link classification has completed. The RPC remains
  // the final authority even after this presentation guard.
  const canActAs = (
    (candidate.gmCapabilities?.actAs ?? (
      classification === 'npc' && candidate.subject.kind === 'npc-card'
    ))
    && summaryReady
    && Boolean(identityLinkId)
    && controller.state.status !== 'loading'
    && controller.state.status !== 'error'
  )
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
  const snapshotIdentityLinkId = currentMode || localInspect ? identityLinkId : undefined
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
  const actPending = classification === 'npc' && pending?.key === key && pending.mode === 'take-control'
  const controlPending = classification === 'player' && pending?.key === key && pending.mode === 'take-control'
  const compromisePending = pending?.key === key && pending.mode === 'compromised-session'

  return (
    <aside className="net-persona-control__detail" aria-labelledby="net-persona-detail-name">
      <div className="net-persona-control__detail-heading">
        <CandidatePortrait candidate={candidate} />
        <div>
          <strong id="net-persona-detail-name">{candidate.displayName}</strong>
          <span>{sourceLabel(candidate)} // {currentMode === 'take-control' && classification === 'npc'
            ? 'ACTING AS'
            : currentMode ? currentMode.replace('-', ' ').toUpperCase() : 'AVAILABLE'}</span>
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

      {identityLinkId ? (
        <>
          <NetGmPrimaryOsControl
            key={identityLinkId}
            identityLinkId={identityLinkId}
            city={candidate.city}
            allowNoOs={classification === 'npc'}
            reconcileEffectiveOs={currentMode === 'take-control'}
          />
          {classification === 'player' ? (
            <NetGmEconomicCurrencyControl identityLinkId={identityLinkId} city={candidate.city} />
          ) : null}
        </>
      ) : classification === 'npc' && candidate.subject.kind === 'npc-card' ? (
        <NetGmNpcNetworkIdentityControl
          subject={candidate.subject}
          onEnabled={onNetworkIdentityEnabled}
        />
      ) : null}

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
          aria-pressed={currentMode === 'inspect' || localInspect}
          onClick={() => onAction('inspect')}
        >
          <Eye size={14} />
          {inspectPending ? 'INSPECTING…' : currentMode === 'inspect' || localInspect ? 'INSPECTING' : 'INSPECT'}
        </button>
        {canActAs ? (
          <button
            type="button"
            className="net-persona-control__act"
            disabled={controller.changing || currentMode === 'take-control'}
            aria-pressed={currentMode === 'take-control'}
            onClick={() => onAction('take-control')}
          >
            <UserRoundCog size={14} />
            {actPending ? 'ENTERING…' : currentMode === 'take-control' ? 'ACTING AS' : 'ACT AS'}
          </button>
        ) : null}
        {canTakeControl ? (
          <>
            <button
              type="button"
              className="net-persona-control__take-control"
              disabled={controller.changing || currentMode === 'take-control'}
              aria-pressed={currentMode === 'take-control'}
              onClick={onRequestTakeControl}
            >
              <Laptop size={14} />
              {controlPending ? 'ENTERING…' : currentMode === 'take-control' ? 'CONTROL ACTIVE' : 'TAKE CONTROL'}
            </button>
            <button
              type="button"
              className="net-persona-control__compromise"
              disabled={controller.changing || controller.session?.mode === 'take-control'}
              aria-pressed={currentMode === 'compromised-session'}
              title="Compromised PULSE session only"
              onClick={onRequestCompromise}
            >
              <ShieldAlert size={14} />
              {compromisePending ? 'STARTING…' : currentMode === 'compromised-session' ? 'PULSE CONTROL ACTIVE' : 'PULSE CONTROL'}
            </button>
          </>
        ) : null}
      </div>
      {confirmingTakeControl && summaryReady ? (
        <section
          className="net-persona-control__compromise-confirm"
          data-kind="take-control"
          role="alertdialog"
          aria-labelledby="net-persona-take-control-title"
          aria-describedby="net-persona-take-control-detail"
        >
          <div>
            <strong id="net-persona-take-control-title">TAKE CONTROL</strong>
            <span>AUTHORITATIVE SYSTEM ROUTING</span>
          </div>
          <p id="net-persona-take-control-detail">
            Enter {candidate.displayName}'s assigned operating environment. The authenticated GM remains the actor; application ownership and server permissions are not fabricated by this control context.
          </p>
          <div>
            <button
              type="button"
              className="net-persona-control__take-control-confirm"
              autoFocus
              disabled={controller.changing}
              onClick={() => onAction('take-control')}
            >
              <Laptop size={14} />
              {controlPending ? 'ENTERING…' : 'ENTER CONTROLLED SYSTEM'}
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
      {confirmingCompromise && summaryReady ? (
        <section
          className="net-persona-control__compromise-confirm"
          data-kind="pulse-control"
          role="alertdialog"
          aria-labelledby="net-persona-compromise-title"
          aria-describedby="net-persona-compromise-detail"
        >
          <div>
            <strong id="net-persona-compromise-title">START PULSE CONTROL</strong>
            <span>COMPROMISED PULSE SESSION ONLY</span>
          </div>
          <p id="net-persona-compromise-detail">
            This separate narrative session can publish PULSE posts and replies through {candidate.displayName}'s existing account. It does not switch operating systems or grant general identity control.
          </p>
          <div>
            <button
              type="button"
              className="net-persona-control__take-control-confirm net-persona-control__take-control-confirm--compromise"
              autoFocus
              disabled={controller.changing}
              onClick={() => onAction('compromised-session')}
            >
              <ShieldAlert size={14} />
              {compromisePending ? 'STARTING…' : 'START PULSE CONTROL'}
            </button>
            <button
              type="button"
              className="net-persona-control__take-control-cancel"
              disabled={controller.changing}
              onClick={onCancelCompromise}
            >
              CANCEL
            </button>
          </div>
        </section>
      ) : null}
      <p className="net-persona-control__authoring-note">
        {currentMode === 'take-control'
          ? classification === 'npc'
            ? 'ACT AS routes through this NPC’s explicit operating system. Player ownership and personal application authority remain unavailable.'
            : 'Controlled identity environment overrides the saved GM workspace. Application authority remains server-enforced.'
          : currentMode === 'compromised-session'
          ? 'Compromised authority is limited to audited PULSE posts and replies.'
          : 'Persona context is read-only. Application content authoring remains unavailable.'}
      </p>
      {currentMode || localInspect ? (
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
  const [actionError, setActionError] = useState<string | null>(null)
  const [takeControlKey, setTakeControlKey] = useState<string | null>(null)
  const [compromiseKey, setCompromiseKey] = useState<string | null>(null)
  const [localInspectKey, setLocalInspectKey] = useState<string | null>(null)
  const [detailRequestVersion, setDetailRequestVersion] = useState(0)
  const detailForceKeyRef = useRef<string | null>(null)
  const [detailState, setDetailState] = useState<PersonaDetailLoadState | null>(null)
  const sessionSubjectKey = controller.session && controller.session.mode !== 'none'
    ? subjectKey(controller.session.subject)
    : null

  useEffect(() => {
    // This component is not remounted when the authenticated GM changes.
    // Resetting transient selection state here prevents cross-account carryover.
    setQuery('')
    setSelectedKey(null)
    setPending(null)
    setActionError(null)
    setTakeControlKey(null)
    setCompromiseKey(null)
    setLocalInspectKey(null)
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
    if (mode === 'inspect' && controller.session?.mode === 'take-control') {
      setSelectedKey(key)
      setLocalInspectKey(key)
      setTakeControlKey(null)
      setCompromiseKey(null)
      return
    }
    setActionError(null)
    setPending({ key, mode })
    try {
      const succeeded = mode === 'take-control'
        ? await controller.controlIdentity(candidate.subject)
        : await controller.setPersona(candidate.subject, mode)
      if (succeeded) {
        setSelectedKey(key)
        setTakeControlKey(null)
        setCompromiseKey(null)
        setLocalInspectKey(null)
      } else {
        setActionError('The persona mutation was not confirmed. Review the server error and retry.')
      }
    } catch (error) {
      setActionError(error instanceof Error
        ? error.message
        : 'The persona mutation failed before server confirmation.')
    } finally {
      setPending((current) => current?.key === key && current.mode === mode ? null : current)
    }
  }

  const clearPersona = async () => {
    setActionError(null)
    setPending({ key: 'session', mode: 'none' })
    try {
      const succeeded = await controller.clearPersona()
      if (succeeded) setSelectedKey(null)
      else setActionError('RETURN TO GM was not confirmed. Review the server error and retry.')
    } catch (error) {
      setActionError(error instanceof Error
        ? error.message
        : 'RETURN TO GM failed before server confirmation.')
    } finally {
      setPending((current) => current?.mode === 'none' ? null : current)
    }
  }

  const activeCandidate = sessionSubjectKey
    ? supportedCandidates.find((candidate) => subjectKey(candidate.subject) === sessionSubjectKey)
    : undefined
  const sessionState = controller.state.status === 'inspect'
    ? 'INSPECTING'
    : controller.state.status === 'controlled'
      ? controller.state.identity.identityKind === 'npc' ? 'ACTING AS' : 'TAKE CONTROL'
    : controller.state.status === 'compromised'
      ? 'PULSE CONTROL'
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
        data-mode={controller.state.status === 'controlled' ? 'take-control' : controller.state.status === 'compromised' ? 'compromised-session' : 'standard'}
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
              <span>{sourceLabel(activeCandidate)} // {controller.state.status === 'controlled'
                ? controller.state.identity.identityKind === 'npc' ? 'NPC OPERATING ENVIRONMENT' : 'CONTROLLED OPERATING ENVIRONMENT'
                : controller.state.status === 'compromised' ? 'AUDITED PULSE CONTROL'
                  : controller.state.status === 'active' ? 'LEGACY NPC PERSONA' : 'INSPECTION CONTEXT'}</span>
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
            {pending?.mode === 'none'
              ? controller.state.status === 'controlled'
                ? controller.state.identity.identityKind === 'npc' ? 'ENDING ACT AS…' : 'ENDING CONTROL…'
                : 'RETURNING…'
              : controller.state.status === 'controlled'
                ? controller.state.identity.identityKind === 'npc' ? 'RETURN TO GM' : 'END CONTROL'
                : 'RETURN TO GM'}
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

      {controller.error || actionError ? (
        <p className="net-persona-control__error" role="alert">{controller.error ?? actionError}</p>
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
                  setCompromiseKey(null)
                  setLocalInspectKey(null)
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
                  setCompromiseKey(null)
                  setLocalInspectKey(null)
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
            confirmingCompromise={compromiseKey === subjectKey(hydratedSelectedCandidate.subject)}
            onRequestCompromise={() => setCompromiseKey(subjectKey(hydratedSelectedCandidate.subject))}
            onCancelCompromise={() => setCompromiseKey(null)}
            localInspect={localInspectKey === subjectKey(hydratedSelectedCandidate.subject)}
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
            onNetworkIdentityEnabled={onRetrySummaries}
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
