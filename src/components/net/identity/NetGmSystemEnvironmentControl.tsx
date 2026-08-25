import { Laptop, RotateCcw, ShieldCheck, UserRoundCog } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  NET_GM_WORKSPACE_CHANGED_EVENT,
  isNetGmWorkspaceStorageEvent,
  readNetGmWorkspace,
  writeNetGmWorkspace,
} from '../../../lib/netGmWorkspaceStore'
import { setNetGmSystemWorkspace } from '../../../lib/netOsService'
import { getNetOsLabel, netOsOptions, type NetOsId } from '../../../lib/netOsTypes'
import { getNetIdentitySubjectId } from './netIdentitySelectors'
import type { NetPlayableIdentityCandidate } from './netIdentityTypes'
import type { NetGmPersonaController } from './useNetGmPersona'
import { NetGmFinanceControl } from './NetGmFinanceControl'
import '../../../styles/netGmEnvironment.css'

interface NetGmSystemEnvironmentControlProps {
  readonly profileId: string
  readonly effectiveOsId: NetOsId
  readonly controlPrimaryOsId?: NetOsId
  readonly controller: NetGmPersonaController
  readonly candidates?: readonly NetPlayableIdentityCandidate[]
  readonly showControlPicker?: boolean
}

function subjectKey(candidate: NetPlayableIdentityCandidate): string {
  return `${candidate.subject.kind}:${getNetIdentitySubjectId(candidate.subject)}`
}

function playableIdentityLinkId(
  candidate: NetPlayableIdentityCandidate,
  controller: NetGmPersonaController,
): string | undefined {
  const authoritative = candidate.authoritativeLink
  if (authoritative?.identityKind === 'player' && authoritative.playability === 'playable') {
    return authoritative.id
  }
  const key = subjectKey(candidate)
  return controller.identityLinks.find((link) => (
    link.identityKind === 'player'
    && link.playability === 'playable'
    && `${link.subject.kind}:${getNetIdentitySubjectId(link.subject)}` === key
  ))?.id
}

export function NetGmSystemEnvironmentControl({
  profileId,
  effectiveOsId,
  controlPrimaryOsId,
  controller,
  candidates = [],
  showControlPicker = false,
}: NetGmSystemEnvironmentControlProps) {
  const [workspaceOsId, setWorkspaceOsId] = useState<NetOsId>(() => readNetGmWorkspace(profileId))
  const [workspaceChanging, setWorkspaceChanging] = useState(false)
  const [selectedControlKey, setSelectedControlKey] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const controlledIdentity = controller.state.status === 'controlled'
    ? controller.state.identity
    : undefined
  const actingIdentity = controller.state.status === 'active'
    ? controller.state.identity
    : undefined
  const controlledNpc = controlledIdentity?.identityKind === 'npc'
  const controlHasOsOverride = Boolean(
    controlledIdentity && (!controlledNpc || controlPrimaryOsId),
  )
  const routingOverrideActive = controlHasOsOverride
  const playableCandidates = useMemo(() => candidates.filter((candidate) => (
    candidate.subject.kind !== 'character'
    && Boolean(playableIdentityLinkId(candidate, controller))
  )), [candidates, controller])
  const controlledKey = controlledIdentity
    ? `${controlledIdentity.subject.kind}:${getNetIdentitySubjectId(controlledIdentity.subject)}`
    : ''
  const selectedCandidate = playableCandidates.find((candidate) => subjectKey(candidate) === selectedControlKey)
    ?? playableCandidates.find((candidate) => subjectKey(candidate) === controlledKey)
    ?? playableCandidates[0]
  const selectedIsControlled = Boolean(controlledKey && selectedCandidate && subjectKey(selectedCandidate) === controlledKey)

  useEffect(() => {
    const sync = () => setWorkspaceOsId(readNetGmWorkspace(profileId))
    const handleStorage = (event: StorageEvent) => {
      if (isNetGmWorkspaceStorageEvent(event, profileId)) sync()
    }
    window.addEventListener(NET_GM_WORKSPACE_CHANGED_EVENT, sync)
    window.addEventListener('storage', handleStorage)
    sync()
    return () => {
      window.removeEventListener(NET_GM_WORKSPACE_CHANGED_EVENT, sync)
      window.removeEventListener('storage', handleStorage)
    }
  }, [profileId])

  const chooseWorkspace = async (osId: NetOsId) => {
    if (routingOverrideActive || workspaceChanging || osId === workspaceOsId) return
    try {
      setError(null)
      setWorkspaceChanging(true)
      await setNetGmSystemWorkspace(osId)
      writeNetGmWorkspace(profileId, osId)
      setWorkspaceOsId(osId)
    } catch (workspaceError) {
      setError(workspaceError instanceof Error
        ? workspaceError.message
        : 'The GM workspace preference could not be changed.')
    } finally {
      setWorkspaceChanging(false)
    }
  }

  const takeControl = async () => {
    if (!selectedCandidate || selectedCandidate.subject.kind === 'character') return
    setError(null)
    const changed = await controller.controlIdentity(selectedCandidate.subject)
    if (!changed) setError(controller.error ?? 'TAKE CONTROL could not be established.')
  }

  const endControl = async () => {
    setError(null)
    const changed = await controller.clearPersona()
    if (!changed) setError(controller.error ?? `${controlledNpc ? 'ACT AS' : 'TAKE CONTROL'} could not be released.`)
  }

  return (
    <>
      <section className="net-gm-environment" aria-labelledby="net-gm-environment-title">
      <header>
        <span><Laptop size={16} aria-hidden="true" /></span>
        <div>
          <p>GM WORKSPACE</p>
          <h3 id="net-gm-environment-title">System environment</h3>
        </div>
        <small>{controlledIdentity
          ? controlledNpc && !controlPrimaryOsId ? 'NO NPC NETWORK OS' : 'CONTROL OVERRIDE'
          : actingIdentity ? 'LEGACY PERSONA // NO ROUTING' : 'BROWSER PREFERENCE'}</small>
      </header>

      <div className="net-gm-environment__status" aria-live="polite">
        <span>{controlledIdentity ? controlledNpc ? 'ACT AS' : 'TAKE CONTROL' : actingIdentity ? 'LEGACY PERSONA' : 'GM SYSTEM'}</span>
        <strong>{controlledIdentity?.displayName ?? actingIdentity?.displayName ?? getNetOsLabel(workspaceOsId)}</strong>
        <em>{controlledIdentity
          ? controlledNpc && !controlPrimaryOsId
            ? `NO NETWORK OS // GM WORKSPACE ${getNetOsLabel(effectiveOsId)}`
            : `OPERATING SYSTEM // ${getNetOsLabel(effectiveOsId)}`
          : actingIdentity
            ? `GM WORKSPACE // ${getNetOsLabel(effectiveOsId)}`
          : `ACTIVE ADMIN ENVIRONMENT // ${getNetOsLabel(effectiveOsId)}`}</em>
      </div>

      <div className="net-gm-environment__choices" aria-label="GM system environment">
        {netOsOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            data-active={!routingOverrideActive && workspaceOsId === option.id ? 'true' : 'false'}
            aria-pressed={!routingOverrideActive && workspaceOsId === option.id}
            disabled={routingOverrideActive || workspaceChanging}
            onClick={() => { void chooseWorkspace(option.id) }}
          >
            {workspaceOsId === option.id && !routingOverrideActive
              ? <ShieldCheck size={13} aria-hidden="true" />
              : <span aria-hidden="true" />}
            {option.label}
          </button>
        ))}
      </div>

      <p className="net-gm-environment__note">
        {controlledIdentity
          ? controlledNpc && !controlPrimaryOsId
            ? 'ACT AS remains active, but this NPC has no explicit network OS. THE NET uses the saved GM workspace without inventing an assignment.'
            : controlledNpc
              ? 'The NPC’s explicit operating system temporarily overrides this browser’s GM workspace. ACT AS does not grant player ownership.'
              : 'The controlled identity environment temporarily overrides this browser’s GM workspace. The saved workspace is restored when control ends.'
          : actingIdentity
            ? 'This legacy persona is presentation-only and does not route THE NET. Start ACT AS again to establish unified controlled-identity routing.'
          : 'This changes Silver’s administration shell only. Character primary-OS assignments and app authority are unchanged.'}
      </p>

      {showControlPicker ? (
        <div className="net-gm-environment__control">
          {controlledNpc && controlledIdentity ? (
            <label>
              <span>ACTING AS</span>
              <select value="controlled-npc" disabled>
                <option value="controlled-npc">{controlledIdentity.displayName}</option>
              </select>
            </label>
          ) : (
            <label>
              <span>CONTROLLED IDENTITY</span>
              <select
                value={selectedCandidate ? subjectKey(selectedCandidate) : ''}
                disabled={controller.changing || !playableCandidates.length}
                onChange={(event) => setSelectedControlKey(event.target.value)}
              >
                {!playableCandidates.length ? <option value="">No playable identities available</option> : null}
                {playableCandidates.map((candidate) => (
                  <option key={subjectKey(candidate)} value={subjectKey(candidate)}>{candidate.displayName}</option>
                ))}
              </select>
            </label>
          )}
          {controlledNpc || (controlledIdentity && selectedIsControlled) ? (
            <button type="button" disabled={controller.changing} onClick={() => { void endControl() }}>
              <RotateCcw size={13} aria-hidden="true" /> {controller.changing ? 'ENDING…' : controlledNpc ? 'RETURN TO GM' : 'END CONTROL'}
            </button>
          ) : (
            <button type="button" disabled={controller.changing || !selectedCandidate} onClick={() => { void takeControl() }}>
              <UserRoundCog size={13} aria-hidden="true" /> {controller.changing ? 'ENTERING…' : controlledIdentity ? 'SWITCH CONTROL' : 'TAKE CONTROL'}
            </button>
          )}
        </div>
      ) : null}

        {error || controller.error ? <p className="net-gm-environment__error" role="alert">{error ?? controller.error}</p> : null}
      </section>
      {controller.state.status === 'none' ? <NetGmFinanceControl /> : null}
    </>
  )
}
