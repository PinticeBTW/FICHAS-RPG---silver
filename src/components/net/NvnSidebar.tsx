import {
  Archive,
  Globe,
  Landmark,
  MessageSquare,
  Newspaper,
  Quote,
  Radio,
  ShieldCheck,
  Signal,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'

import type { NetAppAccessMode } from './netAppCatalog'
import type { NetNvnRealtimeConnectionStatus } from '../../lib/netNvnRealtimeService'
import type { NvnReaderNav } from './useNetNvnReader'

const NAV_ITEMS: { id: NvnReaderNav; label: string; icon: LucideIcon }[] = [
  { id: 'top', label: 'Top Stories', icon: Newspaper },
  { id: 'new-vega', label: 'New Vega', icon: Landmark },
  { id: 'world', label: 'World', icon: Globe },
  { id: 'business', label: 'Business', icon: TrendingUp },
  { id: 'technology', label: 'Technology', icon: Signal },
  { id: 'culture', label: 'Culture', icon: Quote },
  { id: 'opinion', label: 'Opinion', icon: MessageSquare },
  { id: 'live', label: 'Live', icon: Radio },
  { id: 'archive', label: 'Archive', icon: Archive },
]

interface NvnSidebarProps {
  accessMode: NetAppAccessMode
  realtimeStatus: NetNvnRealtimeConnectionStatus
  nav: NvnReaderNav
  isNewsroomControl: boolean
  isLiveControl: boolean
  onOpenNewsroom: () => void
  onOpenLiveControl: () => void
  onNavChange: (nav: NvnReaderNav) => void
}

export function NvnSidebar({
  accessMode,
  realtimeStatus,
  nav,
  isNewsroomControl,
  isLiveControl,
  onOpenNewsroom,
  onOpenLiveControl,
  onNavChange,
}: NvnSidebarProps) {
  const isGmSystemAccess = accessMode === 'gm-system'
  const connectionLabel = realtimeStatus === 'disconnected'
    ? 'Live sync paused'
    : realtimeStatus === 'connecting'
      ? 'Connecting live sync'
      : isGmSystemAccess
        ? 'GM system access'
        : 'Public newsroom'

  return (
    <nav className="nvn-sidebar" aria-label="NVN sections">
      <div className="nvn-sidebar__brand">
        <strong>NVN</strong>
        <span>Independent Network</span>
      </div>

      <div className="nvn-sidebar__status">
        <i data-offline={realtimeStatus === 'disconnected' ? 'true' : undefined} />
        {connectionLabel}
      </div>

      <div className="nvn-sidebar__items">
        {isGmSystemAccess ? (
          <div className="nvn-sidebar__gm-controls">
            <button
              type="button"
              className="nvn-sidebar__control"
              data-active={isNewsroomControl ? 'true' : 'false'}
              onClick={onOpenNewsroom}
              aria-current={isNewsroomControl ? 'page' : undefined}
            >
              <ShieldCheck size={15} aria-hidden="true" />
              <span>Newsroom Control</span>
            </button>
            <button
              type="button"
              className="nvn-sidebar__control"
              data-active={isLiveControl ? 'true' : 'false'}
              onClick={onOpenLiveControl}
              aria-current={isLiveControl ? 'page' : undefined}
            >
              <Radio size={15} aria-hidden="true" />
              <span>Live Control</span>
            </button>
          </div>
        ) : null}
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              data-active={!isNewsroomControl && !isLiveControl && nav === item.id ? 'true' : 'false'}
              onClick={() => onNavChange(item.id)}
              aria-current={!isNewsroomControl && !isLiveControl && nav === item.id ? 'page' : undefined}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      <p className="nvn-sidebar__footnote">
        {isGmSystemAccess
          ? 'Editorial authority is bound to the authenticated GM, never the active persona.'
          : 'Authenticated public-grid reader. No newsroom identity required.'}
      </p>
    </nav>
  )
}
