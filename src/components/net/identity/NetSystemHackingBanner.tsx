import { LogOut } from 'lucide-react'

import { getNetOsLabel, type NetOsId } from '../../../lib/netOsTypes'
import '../../../styles/netSystemHackingBanner.css'

/**
 * The one persistent, always-visible indicator that the current OS chrome
 * is running as a hacking target, not the authenticated actor's own
 * identity -- mounted at the top level of NetHubPage / AltaraOsGateway
 * (outside any app window, including Settings) so it stays visible no
 * matter which app is open. Deliberately minimal: this is not a control
 * surface for managing hacking access (that stays in NetSystemSecurityControl,
 * Settings -> Security, hidden while this banner is showing) -- only
 * identity provenance and the one action every hacked session needs
 * reachable from anywhere, DISCONNECT.
 */
export function NetSystemHackingBanner({
  targetDisplayName,
  sourceDisplayName,
  sourceOsId,
  onDisconnect,
  disconnecting,
  disconnectError,
}: {
  readonly targetDisplayName: string
  readonly sourceDisplayName: string
  readonly sourceOsId: NetOsId
  readonly onDisconnect: () => void
  readonly disconnecting: boolean
  readonly disconnectError: string | null
}) {
  return (
    <div className="net-system-hacking-banner" role="status">
      <div className="net-system-hacking-banner__identity">
        <span>COMPROMISED SYSTEM</span>
        <strong>{targetDisplayName.toUpperCase()}</strong>
        <small>SOURCE // {sourceDisplayName.toUpperCase()} {getNetOsLabel(sourceOsId).toUpperCase()}</small>
      </div>
      <button type="button" disabled={disconnecting} onClick={onDisconnect}>
        <LogOut size={13} aria-hidden="true" /> {disconnecting ? 'DISCONNECTING…' : 'DISCONNECT'}
      </button>
      {disconnectError ? <p role="alert">{disconnectError}</p> : null}
    </div>
  )
}
