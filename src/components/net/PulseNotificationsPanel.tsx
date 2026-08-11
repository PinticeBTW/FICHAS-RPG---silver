import {
  AtSign,
  Bell,
  CheckCheck,
  MessageCircle,
  Repeat2,
  UserPlus,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import type { NetPulseNotification, NetPulseNotificationType } from '../../lib/netPulseNotificationService'
import { SharedMediaImage } from '../shared/SharedMediaImage'
import { PulseLoadMore } from './PulseLoadMore'

const NOTIFICATION_COPY: Record<NetPulseNotificationType, {
  readonly label: string
  readonly icon: LucideIcon
}> = {
  follow: { label: 'followed you', icon: UserPlus },
  reaction: { label: 'reacted to your Pulse', icon: Zap },
  boost: { label: 'boosted your Pulse', icon: Repeat2 },
  reply: { label: 'replied to your Pulse', icon: MessageCircle },
  mention: { label: 'mentioned you', icon: AtSign },
}

function formatNotificationTime(createdAt: string): string {
  const timestamp = Date.parse(createdAt)
  if (!Number.isFinite(timestamp)) return 'NOW'
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'NOW'
  if (minutes < 60) return `${minutes}M`
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}H`
  return `${Math.floor(minutes / 1_440)}D`
}

interface PulseNotificationsPanelProps {
  readonly notifications: readonly NetPulseNotification[]
  readonly unreadCount: number | null
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly refreshing: boolean
  readonly loadingMore: boolean
  readonly hasMore: boolean
  readonly reason?: string
  readonly markingAll: boolean
  readonly onOpen: (notification: NetPulseNotification) => void
  readonly onMarkAllRead: () => void
  readonly onRetry: () => void
  readonly onLoadMore: () => void
}

export function PulseNotificationsPanel({
  notifications,
  unreadCount,
  status,
  refreshing,
  loadingMore,
  hasMore,
  reason,
  markingAll,
  onOpen,
  onMarkAllRead,
  onRetry,
  onLoadMore,
}: PulseNotificationsPanelProps) {
  const hasConfirmedRows = notifications.length > 0
  return (
    <section className="pulse-notifications" aria-labelledby="pulse-notifications-title">
      <header className="pulse-notifications__head">
        <div>
          <h2 id="pulse-notifications-title">NOTIFICATIONS</h2>
          <p>PRIVATE SIGNAL LEDGER</p>
        </div>
        {unreadCount !== null && unreadCount > 0 ? (
          <button
            type="button"
            className="pulse-notifications__mark-all"
            onClick={onMarkAllRead}
            disabled={markingAll}
          >
            <CheckCheck size={14} />
            {markingAll ? 'MARKING…' : 'MARK ALL AS READ'}
          </button>
        ) : null}
      </header>

      {refreshing && hasConfirmedRows ? (
        <p className="pulse-notifications__sync" role="status">REFRESHING PRIVATE SIGNALS</p>
      ) : null}

      {status === 'loading' && !hasConfirmedRows ? (
        <div className="pulse-notifications__placeholder" role="status" aria-live="polite">
          <Bell size={17} />
          <div><strong>SYNCING NOTIFICATIONS</strong><span>Loading a bounded private ledger.</span></div>
        </div>
      ) : status === 'error' && !hasConfirmedRows ? (
        <div className="pulse-notifications__placeholder" role="alert">
          <Bell size={17} />
          <div><strong>PRIVATE SIGNALS UNAVAILABLE</strong><span>{reason ?? 'The inbox could not be synchronized.'}</span></div>
          <button type="button" onClick={onRetry}>RETRY</button>
        </div>
      ) : !hasConfirmedRows ? (
        <div className="pulse-notifications__placeholder">
          <Bell size={17} />
          <div><strong>NO NEW SIGNALS</strong><span>The private grid is quiet.</span></div>
        </div>
      ) : (
        <ul className="pulse-notifications__list">
          {notifications.map((notification) => {
            const definition = NOTIFICATION_COPY[notification.type]
            const Icon = definition.icon
            return (
              <li key={notification.id} data-unread={notification.readAt ? 'false' : 'true'}>
                <button
                  type="button"
                  className="pulse-notifications__row"
                  onClick={() => onOpen(notification)}
                  aria-label={`@${notification.actorHandle} ${definition.label}`}
                >
                  <span className="pulse-notifications__avatar">
                    {notification.actorAvatarUrl ? (
                      <SharedMediaImage
                        source={notification.actorAvatarUrl}
                        variant="thumbnail"
                        alt=""
                        loading="lazy"
                        decoding="async"
                        fallback={<span>{notification.actorHandle.slice(0, 1).toUpperCase()}</span>}
                      />
                    ) : notification.actorHandle.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="pulse-notifications__copy">
                    <strong>@{notification.actorHandle}</strong>
                    <span><Icon size={13} /> {definition.label}</span>
                    {notification.postExcerpt ? <q>{notification.postExcerpt}</q> : notification.type !== 'follow' && !notification.postAvailable ? <em>PULSE UNAVAILABLE</em> : null}
                  </span>
                  <time dateTime={notification.createdAt}>{formatNotificationTime(notification.createdAt)}</time>
                  {!notification.readAt ? <i aria-label="Unread" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <PulseLoadMore
        available={hasMore}
        pending={loadingMore}
        failed={status === 'error' && hasConfirmedRows}
        label="Load more notifications"
        onLoad={status === 'error' ? onRetry : onLoadMore}
      />
    </section>
  )
}
