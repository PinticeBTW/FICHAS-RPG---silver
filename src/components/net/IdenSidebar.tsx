import {
  BadgeCheck,
  CreditCard,
  Gauge,
  History,
  Lock,
  Network,
  ScanFace,
  Search,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { SharedMediaImage } from '../shared/SharedMediaImage'

import type { IdenNav, TrustBand } from './idenData'

const NAV_ITEMS: { id: IdenNav; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: ScanFace },
  { id: 'directory', label: 'Directory', icon: Users },
  { id: 'credentials', label: 'Credentials', icon: CreditCard },
  { id: 'trust', label: 'Trust Index', icon: Gauge },
  { id: 'connections', label: 'Connections', icon: Network },
  { id: 'access', label: 'Access Log', icon: History },
  { id: 'privacy', label: 'Privacy', icon: Lock },
]

interface IdenSidebarProps {
  nav: IdenNav
  onNavChange: (nav: IdenNav) => void
  identityStatus: 'ready' | 'gm-no-persona' | 'identity-required' | 'loading'
  displayName?: string
  handle?: string
  avatarUrl?: string
  trustScore?: number
  trustBand?: TrustBand
  onSearchShortcut: () => void
}

export function IdenSidebar({
  nav,
  onNavChange,
  identityStatus,
  displayName,
  handle,
  avatarUrl,
  trustScore,
  trustBand,
  onSearchShortcut,
}: IdenSidebarProps) {
  const hasIdentity = identityStatus === 'ready'
    && Boolean(displayName && handle && trustScore !== undefined && trustBand)
  const stateLabel = identityStatus === 'gm-no-persona'
    ? 'NO PERSONA'
    : identityStatus === 'loading'
      ? 'RESOLVING IDENTITY'
      : 'IDENTITY NOT LINKED'
  const stateDetail = identityStatus === 'gm-no-persona' ? 'GM SESSION' : 'PERSONAL RECORD UNAVAILABLE'

  return (
    <nav className="iden-sidebar" aria-label="IDEN navigation">
      <div className="iden-sidebar__brand">
        <strong>IDEN</strong>
        <span>A NetWatch Identity System</span>
      </div>

      <button type="button" className="iden-sidebar__search" onClick={onSearchShortcut}>
        <Search size={13} />
        Search Identity
      </button>

      <div className="iden-sidebar__items">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              data-active={nav === item.id ? 'true' : 'false'}
              onClick={() => onNavChange(item.id)}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      <div className="iden-sidebar__self">
        <span className="iden-avatar-compact">
          {hasIdentity && avatarUrl ? (
            <SharedMediaImage source={avatarUrl} variant="thumbnail" alt="" />
          ) : hasIdentity ? (
            displayName?.slice(0, 1).toUpperCase()
          ) : (
            '—'
          )}
        </span>

        <span className="iden-sidebar__self-copy">
          <strong>{hasIdentity ? displayName ?? stateLabel : stateLabel}</strong>
          <small>{hasIdentity ? handle ?? stateDetail : stateDetail}</small>
        </span>
      </div>

      {hasIdentity ? (
        <div className="iden-sidebar__verification">
          <BadgeCheck size={13} />
          Verified
        </div>
      ) : null}

      <div className="iden-sidebar__trust" data-band={hasIdentity ? trustBand : 'unknown'}>
        <span>Trust Index</span>
        <strong>{hasIdentity ? trustScore : '—'}</strong>
        <em>{hasIdentity ? trustBand : 'unavailable'}</em>
      </div>

      <div className="iden-sidebar__status">
        <i />
        NetWatch network — stable
      </div>
    </nav>
  )
}
