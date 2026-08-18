import type { NetOsId } from '../../../lib/netOsTypes'
import type { NetPlayableIdentityCandidateState } from '../identity/netIdentityTypes'
import type { NetGmPersonaController } from '../identity/useNetGmPersona'
import { NetGmPersonaSettings } from '../identity/NetGmPersonaSettings'
import { NetGmSystemEnvironmentControl } from '../identity/NetGmSystemEnvironmentControl'
import '../../../styles/altaraPersonaControl.css'

interface AltaraPersonaControlProps {
  readonly profileId: string
  readonly effectiveOsId: NetOsId
  readonly controlPrimaryOsId?: NetOsId
  readonly controller: NetGmPersonaController
  readonly candidates: NetPlayableIdentityCandidateState
}

/**
 * ALTARA OS's GM identity workspace. This renders the exact same
 * authoritative identity-control layer VEIL's Settings uses
 * (NetGmSystemEnvironmentControl for OS/workspace + Finance Control,
 * NetGmPersonaSettings for the searchable player/NPC directory and
 * TAKE CONTROL / ACT AS) — no second directory implementation, no
 * duplicated server authority. Only the `.altara-persona-control` wrapper
 * exists to scope ALTARA's own visual theme over the shared markup.
 */
export function AltaraPersonaControl({
  profileId,
  effectiveOsId,
  controlPrimaryOsId,
  controller,
  candidates,
}: AltaraPersonaControlProps) {
  return (
    <div className="altara-persona-control">
      <NetGmSystemEnvironmentControl
        profileId={profileId}
        effectiveOsId={effectiveOsId}
        controlPrimaryOsId={controlPrimaryOsId}
        controller={controller}
      />
      {candidates.status === 'loading' ? (
        <div className="net-identity-settings__empty" aria-live="polite">
          <strong>READING AUTHORISED SHEETS</strong>
          <span>Character identities are being resolved for this account.</span>
        </div>
      ) : candidates.status === 'error' ? (
        <div className="net-identity-settings__empty" role="status">
          <strong>IDENTITIES UNAVAILABLE</strong>
          <span>{candidates.reason}</span>
          {candidates.retry ? <button type="button" onClick={candidates.retry}>RETRY</button> : null}
        </div>
      ) : (
        <NetGmPersonaSettings
          candidates={candidates.candidates}
          controller={controller}
          authenticatedProfileId={candidates.authenticatedProfileId}
          warning={candidates.warning}
          onRetrySummaries={candidates.retry}
        />
      )}
    </div>
  )
}
