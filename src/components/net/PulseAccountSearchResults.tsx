import { UserCheck, UserPlus } from 'lucide-react'

import type { NetPulseAccountSummary } from '../../lib/netPulseEngagementService'
import { formatPulseCount } from './pulseData'
import { SharedMediaImage } from '../shared/SharedMediaImage'

interface PulseAccountSearchResultsProps {
  readonly heading?: string
  readonly showHeading?: boolean
  readonly ariaLabel?: string
  readonly results: readonly NetPulseAccountSummary[]
  readonly loading?: boolean
  readonly emptyTitle?: string
  readonly emptyDetail?: string
  readonly currentAccountId: string | null
  readonly canFollow: boolean
  readonly pendingAccountIds: ReadonlySet<string>
  readonly isFollowing: (account: NetPulseAccountSummary) => boolean
  readonly onOpenProfile: (accountId: string) => void
  readonly onToggleFollow: (accountId: string) => void
}

export function PulseAccountSearchResults({
  heading = 'PUBLIC ACCOUNTS',
  showHeading = true,
  ariaLabel = 'Public PULSE accounts',
  results,
  loading = false,
  emptyTitle,
  emptyDetail,
  currentAccountId,
  canFollow,
  pendingAccountIds,
  isFollowing,
  onOpenProfile,
  onToggleFollow,
}: PulseAccountSearchResultsProps) {
  if (results.length === 0 && !loading && !emptyTitle) return null
  return (
    <section className="pulse-account-results" aria-label={ariaLabel} aria-busy={loading}>
      {showHeading ? <h3>{heading}</h3> : null}
      {loading && results.length === 0 ? (
        <div className="pulse-account-results__loading" role="status" aria-live="polite">
          <i /><span>SYNCING PUBLIC ACCOUNTS</span>
        </div>
      ) : results.length === 0 ? (
        <div className="pulse-account-results__empty" role="status">
          <strong>{emptyTitle}</strong>
          {emptyDetail ? <span>{emptyDetail}</span> : null}
        </div>
      ) : null}
      {results.length > 0 ? <ul>
        {results.map((account) => {
          const following = isFollowing(account)
          const pending = pendingAccountIds.has(account.accountId)
          return (
            <li key={account.accountId}>
              <button
                type="button"
                className="pulse-account-results__identity"
                onClick={() => onOpenProfile(account.accountId)}
                aria-label={`Open @${account.handle}'s public profile`}
              >
                <span className="pulse-account-results__avatar">
                  {account.avatarUrl ? <SharedMediaImage source={account.avatarUrl} variant="thumbnail" alt="" loading="lazy" decoding="async" fallback={account.handle.slice(0, 1).toUpperCase()} /> : account.handle.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>@{account.handle}</strong>
                  <small>{formatPulseCount(account.followers)} FOLLOWERS // {formatPulseCount(account.pulses)} PULSES</small>
                </span>
              </button>
              {canFollow
                && account.accountId !== currentAccountId
                && account.status === 'active'
                && account.visibility === 'public' ? (
                <button
                  type="button"
                  className="pulse-account-results__follow"
                  data-following={following ? 'true' : 'false'}
                  disabled={pending}
                  onClick={() => onToggleFollow(account.accountId)}
                  aria-pressed={following}
                >
                  {following ? <UserCheck size={14} /> : <UserPlus size={14} />}
                  {pending ? 'SYNCING' : following ? 'FOLLOWING' : 'FOLLOW'}
                </button>
              ) : null}
            </li>
          )
        })}
      </ul> : null}
    </section>
  )
}
